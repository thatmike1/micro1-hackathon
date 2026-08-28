#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCases } from '../corpus/case-edit.mjs';
import { capture, tail } from '../corpus/exec.mjs';
import { openTrajectory } from '../src/trajectory.mjs';
import { formatReport } from './report.mjs';
import { classify, emptyUsage, totals } from './score.mjs';
import { parseVerdict } from './verdict.mjs';
import { materialiseTest, prepareCase, proofRunner } from './workspace.mjs';

const DEFAULT_MODEL = 'z-ai/glm-5.3-flash';
const PROOF_TIMEOUT_MS = 60_000;

/**
 * CLI: `npm run eval:run -- --candidate baseline-1 [--model <id>] [--cases <id>...] [--out <dir>]
 *       [--concurrency <n>]`
 *
 * Runs one candidate over the corpus and scores it. Per case a pristine and a mutated checkout are
 * prepared under a temp dir — the shared corpus checkout is never written to — the candidate
 * answers, and its verdict is scored by exit code and nothing else: a claimed defect on a buggy
 * case counts only if the candidate's own test, dropped into the library's own test location, goes
 * red on the mutant and green on pristine under the library's own runner.
 *
 * Writes `<out>/<caseId>.jsonl` (one trajectory per candidate run) and `<out>/summary.json`, then
 * prints the report.
 */
async function main(argv) {
  const args = parseArgs(argv);
  const candidate = await import(`./candidates/${args.candidate}.mjs`);
  const apiKey = process.env.OPENROUTER_API_KEY ?? readDotEnv().OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set (env or .env)');

  const cases = loadCases().filter((c) => args.cases.length === 0 || args.cases.includes(c.id));
  if (cases.length === 0) throw new Error('no matching cases');

  const outDir = args.out ?? join('runs', `stage0-${candidate.id}-${stamp(new Date())}`);
  // explicit request config: recorded in every trajectory's run-start and in summary.json, so a
  // run always carries the knobs it ran at. `--reasoning off` disables reasoning; any other value
  // is passed as the effort. `--provider` pins OpenRouter routing to one provider, no fallbacks.
  const requestExtras = {
    ...(args.reasoning
      ? { reasoning: args.reasoning === 'off' ? { enabled: false } : { effort: args.reasoning } }
      : {}),
    ...(args.provider ? { provider: { order: [args.provider], allow_fallbacks: false } } : {}),
  };
  const startedAt = new Date();
  const results = new Array(cases.length);

  // cases share nothing — their own temp checkouts, their own trajectory file — so they run in a
  // small pool. Per-case wall time stays honest; only the run's total wall time is compressed.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(args.concurrency, cases.length) }, async () => {
      for (let i = next++; i < cases.length; i = next++) {
        const record = cases[i];
        const result = await runCase({ record, candidate, outDir, model: args.model, apiKey, requestExtras });
        results[i] = result;
        process.stdout.write(
          `${result.outcome.padEnd(14)} ${record.id.padEnd(22)} ` +
            `${(result.wallMs / 1000).toFixed(1)}s  ${result.usage.totalTokens} tok  ` +
            `${money(result.usage.costUsd)}${result.error ? `  ${result.error}` : ''}\n`,
        );
      }
    }),
  );

  const summary = {
    candidate: candidate.id,
    description: candidate.description,
    model: args.model,
    requestExtras,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    wallMs: Date.now() - startedAt.getTime(),
    totals: totals(results),
    cases: results,
  };
  const summaryPath = join(outDir, 'summary.json');
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`\n${formatReport(summary)}\n\nwrote ${summaryPath}\n`);
}

/**
 * One case end to end: prepare the checkouts, ask the candidate, score the answer.
 * @returns {Promise<object>} the record written into `summary.json`
 */
async function runCase({ record, candidate, outDir, model, apiKey, requestExtras }) {
  const startedAt = Date.now();
  const trajectory = openTrajectory({ file: join(outDir, `${record.id}.jsonl`) });
  let workspace = null;

  try {
    workspace = await prepareCase(record);
    const answer = await candidate.run({ record, workspace, trajectory, model, apiKey, requestExtras });

    if (answer.stopReason === 'error') {
      return finish('error', { error: answer.error, usage: answer.usage });
    }
    const parsed = parseVerdict(answer.text);
    if (!parsed.ok) return finish('no-verdict', { error: parsed.error, usage: answer.usage });

    const verdict = parsed.verdict;
    const proof =
      record.kind === 'buggy' && verdict.defect && verdict.testFile
        ? proveClaim(record, workspace, verdict.testFile.content)
        : null;

    return finish(classify(record.kind, verdict, proof), {
      defect: verdict.defect,
      note: verdict.note,
      usage: answer.usage,
      proof,
      error: verdict.defect && !verdict.testFile ? 'defect claimed with no test file' : null,
    });
  } catch (error) {
    return finish('error', { error: error.message, usage: emptyUsage() });
  } finally {
    workspace?.cleanup();
  }

  function finish(outcome, fields) {
    return {
      id: record.id,
      kind: record.kind,
      library: record.library,
      category: record.category,
      outcome,
      defect: fields.defect ?? null,
      note: fields.note ?? null,
      error: fields.error ?? null,
      proof: fields.proof ?? null,
      usage: fields.usage ?? emptyUsage(),
      wallMs: Date.now() - startedAt,
      trajectory: `${record.id}.jsonl`,
    };
  }
}

/**
 * The double run. The candidate's test is written into both checkouts at the library's own test
 * location and run with the library's own runner; only exit codes are read. Red on the mutant and
 * green on pristine is a proof. Anything else is not, including a test that fails both ways
 * because it does not parse.
 */
function proveClaim(record, workspace, content) {
  const runner = proofRunner(record.library);
  const sides = {};
  for (const side of ['mutant', 'pristine']) {
    materialiseTest(workspace[side], runner, content);
    const result = capture(runner.command, workspace[side], { timeoutMs: PROOF_TIMEOUT_MS });
    sides[side] = { code: result.code, ms: result.ms, tail: tail(result.output, 12).trim() };
  }
  return {
    path: runner.path,
    command: runner.command,
    testFile: content,
    mutant: sides.mutant,
    pristine: sides.pristine,
    proved: sides.mutant.code !== 0 && sides.pristine.code === 0,
  };
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const args = {
    candidate: null,
    model: DEFAULT_MODEL,
    cases: [],
    out: null,
    concurrency: 1,
    reasoning: null,
    provider: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--candidate') args.candidate = argv[++i];
    else if (flag === '--model') args.model = argv[++i];
    else if (flag === '--out') args.out = argv[++i];
    else if (flag === '--concurrency') args.concurrency = Number(argv[++i]);
    else if (flag === '--reasoning') args.reasoning = argv[++i];
    else if (flag === '--provider') args.provider = argv[++i];
    else if (flag === '--cases') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) args.cases.push(argv[++i]);
    } else throw new Error(`unknown argument: ${flag}`);
  }
  if (!args.candidate) throw new Error('--candidate is required, e.g. --candidate baseline-1');
  return args;
}

function money(value) {
  return value == null ? 'cost n/a' : `$${value.toFixed(6)}`;
}

/** filesystem-safe timestamp, matching the trajectory writer's */
function stamp(date) {
  return date.toISOString().replace(/\..+$/, '').replace(/:/g, '-');
}

/** minimal .env reader: `KEY=value` lines, `#` comments, optional surrounding quotes */
function readDotEnv(path = '.env') {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const at = line.indexOf('=');
          return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, '')];
        }),
    );
  } catch {
    return {};
  }
}

await main(process.argv.slice(2));
