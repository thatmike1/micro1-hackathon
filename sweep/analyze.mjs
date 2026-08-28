#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { totals } from '../eval/score.mjs';

/**
 * CLI: `node sweep/analyze.mjs [runsDir]`
 *
 * Reads every `runs/sweep-*/summary.json` and prints the markdown tables `docs/frontier-sweep.md`
 * is built from: the per-model per-case outcome matrix, failure clusters by library and by
 * Stryker mutator shape, the cases that flipped between repetitions, and the cost totals.
 *
 * Run directories end in `-rep<n>`, which is the only place a run's repetition is recorded outside
 * the summary itself. Several directories may share an arm, model and repetition — the pool was
 * run in batches — and are merged into one column here, with the totals recomputed by
 * `eval/score.mjs` rather than added up by hand.
 */
const RUNS_DIR = process.argv[2] ?? 'runs';

/** an outcome rendered as one character, so a wide matrix still fits a page */
const MARK = {
  proved: 'P',
  'claim-unproved': 'u',
  miss: '.',
  correct: 'C',
  'false-alarm': 'A',
  'no-verdict': '?',
  error: 'E',
};

function loadRuns() {
  const runs = readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('sweep-'))
    .map((e) => {
      const summary = JSON.parse(readFileSync(join(RUNS_DIR, e.name, 'summary.json'), 'utf8'));
      const rep = Number(/-rep(\d+)$/.exec(e.name)?.[1] ?? 0);
      return { dir: e.name, arm: summary.candidate, model: summary.model, rep, summary };
    });

  const merged = new Map();
  for (const run of runs.sort((a, b) => a.dir.localeCompare(b.dir))) {
    const key = `${run.arm}|${run.model}|rep${run.rep}`;
    const found = merged.get(key);
    if (found) {
      // a case can appear in two batches (the controls were run with both); keep the first
      const seen = new Set(found.cases.map((c) => c.id));
      found.dirs.push(run.dir);
      found.cases.push(...run.summary.cases.filter((c) => !seen.has(c.id)));
      found.wallMs += run.summary.wallMs;
    } else {
      merged.set(key, {
        key,
        column: `${shortModel(run.model)}#${run.rep}`,
        arm: run.arm,
        model: run.model,
        rep: run.rep,
        dirs: [run.dir],
        cases: [...run.summary.cases],
        wallMs: run.summary.wallMs,
      });
    }
  }
  return [...merged.values()].map((run) => ({ ...run, totals: totals(run.cases) }));
}

/** the part of a model id that identifies it in a column header */
function shortModel(id) {
  return id.split('/').pop();
}

/** proof rate over the buggy cases a run actually covered */
function rate(cases) {
  const buggy = cases.filter((c) => c.kind === 'buggy');
  const proved = buggy.filter((c) => c.outcome === 'proved').length;
  return buggy.length === 0 ? '—' : `${proved}/${buggy.length}`;
}

function pct(part, whole) {
  return whole === 0 ? '—' : `${((100 * part) / whole).toFixed(0)}%`;
}

function main() {
  const runs = loadRuns();
  if (runs.length === 0) throw new Error(`no sweep-* runs under ${RUNS_DIR}`);

  const out = [];
  for (const arm of [...new Set(runs.map((r) => r.arm))]) {
    const armRuns = runs.filter((r) => r.arm === arm).sort((a, b) => a.key.localeCompare(b.key));
    const models = [...new Set(armRuns.map((r) => r.model))];
    const byRun = new Map(armRuns.map((r) => [r.key, new Map(r.cases.map((c) => [c.id, c]))]));
    const ids = [...new Set(armRuns.flatMap((r) => r.cases.map((c) => c.id)))].sort();

    out.push(`\n## arm \`${arm}\`\n`);
    out.push(`| case | kind | library | shape | ${armRuns.map((r) => r.column).join(' | ')} |`);
    out.push(`|---|---|---|---|${armRuns.map(() => '---').join('|')}|`);
    for (const id of ids) {
      const any = armRuns.map((r) => byRun.get(r.key).get(id)).find(Boolean);
      const cells = armRuns.map((r) => MARK[byRun.get(r.key).get(id)?.outcome] ?? ' ');
      out.push(`| \`${id}\` | ${any.kind} | ${any.library} | ${any.category} | ${cells.join(' | ')} |`);
    }

    out.push('\n| run | proof rate | false alarms | no-verdict | errors | tokens | cost | wall |');
    out.push('|---|---|---|---|---|---|---|---|');
    for (const run of armRuns) {
      const t = run.totals;
      out.push(
        `| ${run.model} rep ${run.rep} | ${t.proved}/${t.buggy} (${pct(t.proved, t.buggy)}) | ` +
          `${t.falseAlarms}/${t.controls} | ${t.noVerdict} | ${t.errors} | ` +
          `${t.usage.totalTokens.toLocaleString()} | $${(t.usage.costUsd ?? 0).toFixed(4)} | ` +
          `${(run.wallMs / 60000).toFixed(1)} min |`,
      );
    }

    // clusters: proof rate per model over each library and each mutator shape, both reps pooled
    for (const dimension of ['library', 'category']) {
      const groups = [
        ...new Set(armRuns.flatMap((r) => r.cases.filter((c) => c.kind === 'buggy').map((c) => c[dimension]))),
      ].sort();
      out.push(`\n### by ${dimension}, reps pooled\n`);
      out.push(`| ${dimension} | ${models.map(shortModel).join(' | ')} |`);
      out.push(`|---|${models.map(() => '---').join('|')}|`);
      for (const group of groups) {
        const cells = models.map((model) =>
          rate(armRuns.filter((r) => r.model === model).flatMap((r) => r.cases).filter((c) => c[dimension] === group)),
        );
        out.push(`| ${group} | ${cells.join(' | ')} |`);
      }
    }

    // rep instability: same model, same case, different outcome across repetitions
    const flips = [];
    for (const model of models) {
      const reps = armRuns.filter((r) => r.model === model).sort((a, b) => a.rep - b.rep);
      if (reps.length < 2) continue;
      for (const id of ids) {
        const outcomes = reps.map((r) => byRun.get(r.key).get(id)?.outcome ?? 'not run');
        if (new Set(outcomes).size > 1) flips.push({ model, id, outcomes });
      }
    }
    out.push(`\n### rep instability (${flips.length} case-model pairs flipped)\n`);
    if (flips.length > 0) {
      out.push('| model | case | rep 1 | rep 2 |');
      out.push('|---|---|---|---|');
      for (const f of flips) out.push(`| ${shortModel(f.model)} | \`${f.id}\` | ${f.outcomes.join(' | ')} |`);
    }
  }

  const spend = runs.reduce((sum, r) => sum + (r.totals.usage.costUsd ?? 0), 0);
  const tokens = runs.reduce((sum, r) => sum + r.totals.usage.totalTokens, 0);
  out.push(`\n**total across ${runs.length} model-arm-repetition runs: ${tokens.toLocaleString()} tokens, $${spend.toFixed(4)}**`);
  process.stdout.write(`${out.join('\n')}\n`);
}

main();
