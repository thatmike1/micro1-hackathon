import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent } from '../../src/agent-loop.mjs';
import { codePair, formatGate, gateRules, gateToolDescription } from '../gate.mjs';
import { changeUnderReview, reviewFraming, verdictContract } from '../prompt.mjs';
import { parseVerdict } from '../verdict.mjs';
import { doubleRun, proofRunner } from '../workspace.mjs';

export const id = 'stage-2';
export const description =
  'hypothesizer/prover split: a ranked ledger of candidate defects, proved one entry at a time through the stage-1 gate';

/**
 * The same total gate budget stage 1 had. Splitting the roles must not buy extra attempts, or the
 * comparison against row 1 measures the budget instead of the split.
 */
const MAX_GATE_ATTEMPTS = 4;
/** attempts one hypothesis gets before it is abandoned and the next one is taken up */
const ATTEMPTS_PER_HYPOTHESIS = 2;
/** how many entries the hypothesizer may rank; the prover only reaches as far as the budget allows */
const MAX_LEDGER = 4;

const HYPOTHESIZER_STEPS = 4;
/** two gate attempts, the answer, and slack */
const PROVER_STEPS = 6;
const GATE_TIMEOUT_MS = 60_000;
/** pinned per stage 1, and for the same reason: a runaway generation becomes a fast no-verdict */
const MAX_TOKENS = 4096;

/**
 * Stage 2: stage 1's prover loop with the reading and the proving split into two roles.
 *
 * The **hypothesizer** sees what baseline 1 and stage 1 saw — the changed file and the diff — and
 * has no gate. It writes a ranked ledger of candidate defects, most likely first, each entry
 * naming an input, the behaviour the original had, and the behaviour the change produces. It may
 * rank nothing at all: an empty ledger is the assertion that the change is an equivalent refactor,
 * and it ends the review without a single gate attempt.
 *
 * The **prover** then takes the ledger one entry at a time, in rank order, and tries to prove that
 * entry through the gate stage 1 used, unchanged — the harness writes its test into both
 * checkouts, runs the library's own runner in each, and reads the two exit codes. Each hypothesis
 * gets {@link ATTEMPTS_PER_HYPOTHESIS} attempts out of a total of {@link MAX_GATE_ATTEMPTS}; when
 * they are spent the hypothesis is abandoned, the next one is taken up with the failed exit-code
 * pairs carried forward, and the budget shrinks.
 *
 * The gate, not either role's prose, produces the answer, exactly as in stage 1:
 *
 * - a passed gate is answered as a defect, carrying the exact test that passed
 * - a ledger recorded as empty is answered as `defect: false`
 * - `defect: false` from the last prover stands as it wrote it
 * - a defect claim that never passed the gate is withheld — the run is a no-verdict
 * - a hypothesizer that recorded no ledger at all is withheld too: "nothing to prove" is a
 *   verdict, "no answer" is not, and the two must not score the same
 *
 * @param {object} options
 * @param {import('../../corpus/case-edit.mjs').CaseRecord} options.record
 * @param {import('../workspace.mjs').Workspace} options.workspace
 * @param {{write: Function, events: object[]}} options.trajectory
 * @param {string} options.model
 * @param {string} options.apiKey
 */
export async function run({ record, workspace, trajectory, model, apiKey, requestExtras = {}, transport }) {
  const { entry, diff } = changeUnderReview(record);
  const source = readFileSync(join(workspace.mutant, entry), 'utf8');
  const runner = proofRunner(record.library);
  const change = changeBlock(entry, source, diff);
  const shared = {
    model,
    apiKey,
    trajectory,
    ...(transport ? { transport } : {}),
    extraBody: { usage: { include: true }, max_tokens: MAX_TOKENS, ...requestExtras },
  };

  const usage = zeroUsage();
  const hypothesized = await hypothesize({ record, change, shared, trajectory, caseId: record.id });
  addRunUsage(usage, hypothesized.answer.usage);

  if (hypothesized.answer.stopReason === 'error') {
    return { ...hypothesized.answer, usage };
  }

  const ledger = hypothesized.ledger;
  trajectory.write('ledger', {
    entries: ledger.length,
    source: hypothesized.source,
    hypotheses: ledger.map((h, i) => ({ rank: i + 1, ...h })),
  });

  /** @type {{attempt: number, hypothesis: number, passed: boolean, content: string, result: object}[]} */
  const attempts = [];
  /** @type {{rank: number, claim: string, codes: string[]}[]} */
  const abandoned = [];
  let last = hypothesized.answer;

  for (let rank = 1; rank <= ledger.length; rank += 1) {
    const budget = Math.min(ATTEMPTS_PER_HYPOTHESIS, MAX_GATE_ATTEMPTS - attempts.length);
    if (budget <= 0) break;

    last = await prove({
      record,
      workspace,
      runner,
      change,
      ledger,
      rank,
      budget,
      abandoned,
      attempts,
      shared,
      trajectory,
    });
    addRunUsage(usage, last.usage);

    if (attempts.some((a) => a.passed)) break;
    const mine = attempts.filter((a) => a.hypothesis === rank);
    abandoned.push({
      rank,
      claim: ledger[rank - 1].claim,
      codes: mine.map((a) => codePair(a.result)),
    });
    if (last.stopReason === 'error') break;
  }

  return { ...settle({ answer: last, attempts, ledger, ledgered: hypothesized.source !== 'none', runner, trajectory }), usage };
}

/**
 * The hypothesizer turn: read the change, rank what could be wrong with it, record nothing else.
 * It has one tool, and that tool only stores what it is given — no gate, no checkout, no runner.
 */
async function hypothesize({ record, change, shared, trajectory, caseId }) {
  /** @type {{claim: string, input: string, expected: string, observed: string}[] | null} */
  let recorded = null;

  const tools = [
    {
      name: 'record-ledger',
      description:
        'Record the ranked ledger of candidate defects for this change, most likely first. ' +
        'Pass an empty list if the change is an equivalent refactor and there is nothing to ' +
        'prove. This tool only stores the ledger; it runs nothing.',
      parameters: {
        type: 'object',
        properties: {
          hypotheses: {
            type: 'array',
            description: `at most ${MAX_LEDGER} entries, ranked most likely first; empty for an equivalent refactor`,
            items: {
              type: 'object',
              properties: {
                claim: { type: 'string', description: 'the observable behaviour the change breaks, in one sentence' },
                input: { type: 'string', description: 'a concrete call that reaches it, e.g. `ms("1y")`' },
                expected: { type: 'string', description: 'what the original returns for that call' },
                observed: { type: 'string', description: 'what the changed build returns instead' },
              },
              required: ['claim', 'input', 'expected', 'observed'],
            },
          },
        },
        required: ['hypotheses'],
      },
      execute: ({ hypotheses }) => {
        if (!Array.isArray(hypotheses)) throw new Error('hypotheses must be a list, empty if there is nothing to prove');
        recorded = hypotheses.slice(0, MAX_LEDGER).map(normaliseEntry).filter((h) => h.claim !== '');
        return recorded.length === 0
          ? 'Ledger recorded as empty: no candidate defect, the change is an equivalent refactor. ' +
              'The review ends here. Say so in one sentence and stop.'
          : `Ledger recorded, ${recorded.length} hypothes${recorded.length === 1 ? 'is' : 'es'} in rank order. ` +
              'A prover will take them one at a time. Say nothing further and stop.';
      },
    },
  ];

  const answer = await runAgent({
    ...shared,
    caseId,
    instructions: [reviewFraming(record), '', ledgerContract()].join('\n'),
    tools,
    task: [
      change,
      '',
      'Do not write a test and do not decide the review. Rank what could be wrong with this change',
      'and record the ledger.',
    ].join('\n'),
    maxSteps: HYPOTHESIZER_STEPS,
  });

  // a ledger written as prose instead of a tool call is still a ledger; parsing it back is
  // cheaper than spending a repetition on a formatting failure. Whether one arrived at all is
  // tracked separately from whether it was empty: "no candidate defect" and "no answer" are
  // different verdicts, and only the first of them is clean.
  const fromText = recorded ? null : parseLedger(answer.text);
  const ledger = recorded ?? fromText ?? [];
  return { answer, ledger, source: recorded ? 'tool' : fromText ? 'text' : 'none' };
}

/**
 * One prover run: a fresh conversation holding the change, the whole ledger for context, and one
 * hypothesis to prove. It gets the stage-1 gate with a smaller budget, and what earlier
 * hypotheses cost, so it does not resubmit a test that has already been rejected.
 */
async function prove({
  record,
  workspace,
  runner,
  change,
  ledger,
  rank,
  budget,
  abandoned,
  attempts,
  shared,
  trajectory,
}) {
  let used = 0;

  const tools = [
    {
      name: 'submit-proof',
      description: gateToolDescription(runner, budget),
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'complete source of the test file, runnable as written' },
        },
        required: ['content'],
      },
      execute: ({ content }) => {
        if (used >= budget) {
          return (
            `All ${budget} gate attempts for this hypothesis are used. No further test can be ` +
            'submitted. Answer now: `defect: false` if you have concluded this hypothesis is ' +
            'wrong, otherwise the claim is recorded as unproved.'
          );
        }
        if (typeof content !== 'string' || content.trim() === '') {
          throw new Error('content must be the complete source of the test file');
        }

        used += 1;
        const result = doubleRun({
          library: record.library,
          workspace,
          content,
          timeoutMs: GATE_TIMEOUT_MS,
        });
        attempts.push({ attempt: attempts.length + 1, hypothesis: rank, passed: result.proved, content, result });

        trajectory.write('gate-attempt', {
          step: currentStep(trajectory),
          attempt: attempts.length,
          of: MAX_GATE_ATTEMPTS,
          hypothesis: rank,
          hypothesisAttempt: used,
          passed: result.proved,
          path: result.path,
          command: result.command,
          testFile: content,
          mutant: result.mutant,
          pristine: result.pristine,
        });

        return formatGate(used, result, budget);
      },
    },
  ];

  return runAgent({
    ...shared,
    caseId: `${record.id}#h${rank}`,
    instructions: [
      reviewFraming(record),
      '',
      verdictContract(record),
      '',
      proverContract(runner, budget, rank, ledger.length),
    ].join('\n'),
    tools,
    task: proverTask({ change, ledger, rank, abandoned }),
    maxSteps: PROVER_STEPS,
  });
}

/**
 * Turn the run's state into the answer the scorer sees. Same precedence as stage 1 — the gate
 * outranks the prose, and an unproved claim is withheld — with the empty ledger added as its own
 * way of reaching a clean answer without ever touching the gate.
 */
export function settle({ answer, attempts, ledger, ledgered = true, runner, trajectory }) {
  const passed = attempts.find((a) => a.passed) ?? null;
  const parsed = parseVerdict(answer.text);
  const note = parsed.ok && parsed.verdict.note ? parsed.verdict.note : '';

  if (passed) {
    const text = fence({
      defect: true,
      testFile: { path: runner.path, content: passed.content },
      note:
        note ||
        `gate passed on hypothesis ${passed.hypothesis}, attempt ${passed.attempt}: red on the changed checkout, green on the original`,
    });
    trajectory.write('gate-outcome', {
      resolution: 'proved',
      attempts: attempts.length,
      passedOn: passed.attempt,
      hypothesis: passed.hypothesis,
      ledger: ledger.length,
    });
    return { ...answer, text, stopReason: 'final', error: null };
  }

  if (ledger.length === 0 && ledgered) {
    trajectory.write('gate-outcome', {
      resolution: 'clean',
      attempts: 0,
      via: 'empty-ledger',
      ledger: 0,
    });
    return {
      ...answer,
      text: fence({
        defect: false,
        note: note || 'the ledger is empty: no candidate defect was ranked, the change is an equivalent refactor',
      }),
      stopReason: 'final',
      error: null,
    };
  }

  if (ledgered && parsed.ok && !parsed.verdict.defect) {
    trajectory.write('gate-outcome', {
      resolution: 'clean',
      attempts: attempts.length,
      via: 'prover',
      ledger: ledger.length,
    });
    return answer;
  }

  trajectory.write('gate-outcome', {
    resolution: 'withheld',
    attempts: attempts.length,
    ledger: ledger.length,
    reason: !ledgered
      ? 'the hypothesizer recorded no ledger'
      : parsed.ok
        ? 'defect claimed, gate never passed'
        : `no parseable verdict: ${parsed.error}`,
  });
  return {
    ...answer,
    text: !ledgered
      ? 'No ledger was recorded, so nothing was put to the gate. The review is withheld.'
      : `The gate was not passed in ${attempts.length} attempt(s) across ${ledger.length} ranked ` +
        `hypothes${ledger.length === 1 ? 'is' : 'es'}: no test was produced that fails on the ` +
        'changed checkout and passes on the original. The claim is withheld.',
    stopReason: 'final',
  };
}

/** the change under review, framed once and reused by both roles */
function changeBlock(entry, source, diff) {
  return [
    `The change is to \`${entry}\`. Here is that file as it stands after the change:`,
    '',
    '```javascript',
    source,
    '```',
    '',
    'And here is the diff that produced it:',
    '',
    '```diff',
    diff,
    '```',
  ].join('\n');
}

/** what the hypothesizer is asked for, and what an empty answer means */
function ledgerContract() {
  return [
    'You are the first of two reviewers. You do not decide this review and you do not write tests.',
    'Your job is to rank what could be wrong with the change, so the second reviewer spends its',
    'attempts in the right order.',
    '',
    `Call \`record-ledger\` once with at most ${MAX_LEDGER} hypotheses, ranked most likely first.`,
    'Each one names a concrete call that reaches the changed code, what the original returns for',
    'it, and what the changed build returns instead. Rank by how sure you are that a test written',
    'against the entry would fail on the changed build and pass on the original: the second',
    'reviewer works down the list and its attempts are few, so a weak first entry costs the review.',
    '',
    'Record an EMPTY list if the change is an equivalent refactor — renaming, reordering,',
    'restructuring with the same result for every input. An empty ledger ends the review with a',
    'clean verdict and spends nothing. It is the right answer whenever you cannot name an input',
    'whose result actually differs; a hypothesis you cannot write an input for is not a hypothesis.',
    '',
    'Call the tool once, then stop.',
  ].join('\n');
}

/** what the prover is told: the stage-1 gate, over one hypothesis at a time */
function proverContract(runner, budget, rank, total) {
  const last = rank === total;
  return [
    'You are the second of two reviewers. A first reviewer ranked the candidate defects in this',
    'change; you take them one at a time and try to prove one.',
    '',
    'Before you may answer `defect: true`, your test has to pass a gate you do not control.',
    '',
    gateRules(runner, budget),
    '',
    `These ${budget} attempts are for hypothesis ${rank} of ${total} only. ` +
      (last
        ? 'It is the last entry in the ledger, so when they are spent the review is over.'
        : 'When they are spent this hypothesis is abandoned and the next entry in the ledger is taken up.'),
    '',
    'Answer `defect: false` if this hypothesis is wrong and the change is an equivalent refactor,',
    'with no gate attempt at all if you can already see it. If you claim a defect and never pass',
    'the gate, the review is recorded as no verdict: an unproved claim is worth nothing here.',
    '',
    'When the gate passes, answer with the verdict JSON, using exactly the test that passed.',
  ].join('\n');
}

/** the prover's task: the change, the ledger, the entry it owns, and what earlier entries cost */
function proverTask({ change, ledger, rank, abandoned }) {
  const lines = [change, '', 'The first reviewer ranked these candidate defects:', ''];
  ledger.forEach((h, i) => {
    lines.push(`${i + 1}. ${h.claim}`);
    lines.push(`   input: ${h.input}   expected: ${h.expected}   on the changed build: ${h.observed}`);
  });
  lines.push('', `You are working hypothesis ${rank}: ${ledger[rank - 1].claim}`);

  if (abandoned.length > 0) {
    lines.push('', 'Already tried and abandoned, with the exit codes each test came back with');
    lines.push('(changed/original — a proof is a non-zero on the changed side and a zero on the original):');
    for (const prior of abandoned) {
      lines.push(`- ${prior.rank}. ${prior.claim} — ${prior.codes.length ? prior.codes.join(', ') : 'no test submitted'}`);
    }
    lines.push('', 'Do not resubmit a test those attempts already ruled out.');
  }

  lines.push('', 'Prove hypothesis ' + rank + ' with `submit-proof`, or answer that it is wrong.');
  return lines.join('\n');
}

/** a ledger the model wrote as prose rather than as a tool call */
function parseLedger(text) {
  if (typeof text !== 'string') return null;
  for (const match of text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)) {
    let parsed;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }
    const list = Array.isArray(parsed) ? parsed : parsed?.hypotheses;
    if (Array.isArray(list)) return list.slice(0, MAX_LEDGER).map(normaliseEntry).filter((h) => h.claim !== '');
  }
  return null;
}

/** @returns {{claim: string, input: string, expected: string, observed: string}} */
function normaliseEntry(entry) {
  const str = (value) => (typeof value === 'string' ? value.trim() : '');
  return {
    claim: str(entry?.claim),
    input: str(entry?.input) || '(none given)',
    expected: str(entry?.expected) || '(none given)',
    observed: str(entry?.observed) || '(none given)',
  };
}

function fence(verdict) {
  return ['```json', JSON.stringify(verdict), '```'].join('\n');
}

/**
 * The turn a gate attempt belongs to. Stage 2 writes several runs into one trajectory, so this
 * reads the last `step` event in the file rather than tracking a counter of its own.
 */
function currentStep(trajectory) {
  for (let i = trajectory.events.length - 1; i >= 0; i -= 1) {
    if (trajectory.events[i].type === 'step') return trajectory.events[i].step ?? null;
  }
  return null;
}

/** @returns {import('../../src/trajectory.mjs').Usage} */
function zeroUsage() {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null };
}

/** stage 2 spends several model runs per case; the scorer sees one usage block for the case */
function addRunUsage(total, part) {
  if (!part) return total;
  total.promptTokens += part.promptTokens ?? 0;
  total.completionTokens += part.completionTokens ?? 0;
  total.totalTokens += part.totalTokens ?? 0;
  if (typeof part.costUsd === 'number') total.costUsd = (total.costUsd ?? 0) + part.costUsd;
  return total;
}
