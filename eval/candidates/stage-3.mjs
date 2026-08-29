import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent } from '../../src/agent-loop.mjs';
import { codePair, formatGate, gateRules, gateToolDescription } from '../gate.mjs';
import { defaultMemoryPath, emptyMemory, memoryBlock, readMemory, writeLessons } from '../memory.mjs';
import { changeUnderReview, reviewFraming, reviewInstructions, verdictContract } from '../prompt.mjs';
import { doubleRun, proofRunner } from '../workspace.mjs';
import { settle as settleDirect } from './stage-1.mjs';
import { settle as settleSplit } from './stage-2.mjs';

export const id = 'stage-3';
export const description =
  'cross-case memory: a written file of lessons carried from case to case, over the shipped stage of each engine';

/** stage 1's budget, kept by stage 2, kept here: memory must not buy extra attempts */
const MAX_GATE_ATTEMPTS = 4;
/** stage 2's per-hypothesis share of that budget */
const ATTEMPTS_PER_HYPOTHESIS = 2;
const MAX_LEDGER = 4;

/** stage 1's turn budget for the single reviewer */
const DIRECT_STEPS = 10;
const HYPOTHESIZER_STEPS = 4;
const PROVER_STEPS = 6;
const GATE_TIMEOUT_MS = 60_000;
/** pinned as in stages 1 and 2, and for the same reason */
const MAX_TOKENS = 4096;

/**
 * Stage 3: the shipped stage of each engine, plus one file.
 *
 * Row 2 left the configuration split — stage 2 on flash, stage 1 on qwen — so this stage is not
 * one candidate over both engines. `options.base` selects which shipped loop runs underneath, and
 * the loop is reproduced here rather than imported because neither shipped candidate exposes a
 * seam for the memory to enter through, and neither may be edited. What is imported is the part
 * that must not drift: the gate (`../gate.mjs`) and each stage's `settle`, which decides what the
 * scorer sees. The equivalence is tested rather than asserted — with the memory empty, this
 * candidate's request bodies are byte-identical to the shipped stage's.
 *
 * The memory itself is a markdown file in the run directory:
 *
 * - before the review, whatever the file already holds is shown to every role, as notes the
 *   reviewer wrote on earlier changes in the same queue
 * - after the verdict has settled, a scribe turn reads what this review did and appends at most
 *   three one-sentence lessons
 *
 * The scribe never sees `record.kind` or the scorer's outcome, so the memory is written from the
 * review's own evidence and can carry a wrong lesson forward. That is the point of measuring it.
 *
 * `options.memory: 'off'` is the ablation arm: no read, no scribe, no memory file. Everything else
 * about the run — case order, engine, slices, budget, cap — is identical, so the two arms differ
 * by the file and nothing else.
 *
 * @param {object} options
 * @param {import('../../corpus/case-edit.mjs').CaseRecord} options.record
 * @param {import('../workspace.mjs').Workspace} options.workspace
 * @param {{write: Function, events: object[], path?: string}} options.trajectory
 * @param {string} options.model
 * @param {string} options.apiKey
 * @param {{base?: 'stage-1'|'stage-2', memory?: 'on'|'off', memoryFile?: string}} [options.options]
 */
export async function run({
  record,
  workspace,
  trajectory,
  model,
  apiKey,
  requestExtras = {},
  transport,
  options = {},
}) {
  const base = options.base ?? 'stage-2';
  if (base !== 'stage-1' && base !== 'stage-2') throw new Error(`unknown base stage: ${base}`);
  const enabled = String(options.memory ?? 'on') !== 'off';
  const file = options.memoryFile ?? defaultMemoryPath(trajectory);

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

  const memory = enabled ? readMemory(file) : emptyMemory();
  const block = memoryBlock(memory);
  trajectory.write('memory-read', {
    enabled,
    file: enabled ? file : null,
    entries: memory.entries,
    chars: memory.text.length,
    text: memory.text,
  });

  const usage = zeroUsage();
  const reviewed =
    base === 'stage-1'
      ? await reviewDirect({ record, workspace, runner, change, block, shared, trajectory, usage })
      : await reviewSplit({ record, workspace, runner, change, block, shared, trajectory, usage });

  if (reviewed.aborted) return { ...reviewed.answer, usage };

  const settled =
    base === 'stage-1'
      ? settleDirect(reviewed.answer, reviewed.attempts, runner, trajectory)
      : settleSplit({
          answer: reviewed.answer,
          attempts: reviewed.attempts,
          ledger: reviewed.ledger,
          ledgered: reviewed.ledgered,
          runner,
          trajectory,
        });

  if (enabled) {
    const scribe = await writeLessons({
      record,
      path: file,
      memory,
      diff,
      review: {
        resolution: resolutionOf(trajectory),
        attempts: reviewed.attempts,
        ledger: reviewed.ledger,
      },
      shared,
      trajectory,
    });
    addRunUsage(usage, scribe);
  }

  return { ...settled, usage };
}

/**
 * The stage-1 shape: one reviewer that reads the change and proves it through the gate, with the
 * memory block added to what it reads. Qwen's shipped stage.
 */
async function reviewDirect({ record, workspace, runner, change, block, shared, trajectory, usage }) {
  /** @type {{attempt: number, passed: boolean, content: string, result: object}[]} */
  const attempts = [];

  const tools = [
    {
      name: 'submit-proof',
      description: gateToolDescription(runner, MAX_GATE_ATTEMPTS),
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'complete source of the test file, runnable as written',
          },
        },
        required: ['content'],
      },
      execute: ({ content }) => {
        if (attempts.length >= MAX_GATE_ATTEMPTS) {
          return (
            `All ${MAX_GATE_ATTEMPTS} gate attempts are used. No further test can be submitted. ` +
            'Answer now: `defect: false` if you have concluded the change is an equivalent ' +
            'refactor, otherwise the claim is recorded as unproved.'
          );
        }
        if (typeof content !== 'string' || content.trim() === '') {
          throw new Error('content must be the complete source of the test file');
        }

        const attempt = attempts.length + 1;
        const result = doubleRun({
          library: record.library,
          workspace,
          content,
          timeoutMs: GATE_TIMEOUT_MS,
        });
        attempts.push({ attempt, passed: result.proved, content, result });

        trajectory.write('gate-attempt', {
          step: currentStep(trajectory),
          attempt,
          of: MAX_GATE_ATTEMPTS,
          passed: result.proved,
          path: result.path,
          command: result.command,
          testFile: content,
          mutant: result.mutant,
          pristine: result.pristine,
        });

        return formatGate(attempt, result);
      },
    },
  ];

  const answer = await runAgent({
    ...shared,
    caseId: record.id,
    instructions: [reviewInstructions(record), '', gateContract(runner)].join('\n'),
    tools,
    task: [
      change,
      ...notes(block),
      '',
      'Review this change. Is it correct? If it is wrong, prove it with `submit-proof` before you',
      'answer.',
    ].join('\n'),
    maxSteps: DIRECT_STEPS,
  });
  addRunUsage(usage, answer.usage);

  return { answer, attempts, ledger: null, ledgered: true, aborted: false };
}

/**
 * The stage-2 shape: a hypothesizer that ranks a ledger and a prover that takes it one entry at a
 * time through the gate, with the memory block added to what both of them read. Flash's shipped
 * stage.
 */
async function reviewSplit({ record, workspace, runner, change, block, shared, trajectory, usage }) {
  const hypothesized = await hypothesize({ record, change, block, shared, trajectory });
  addRunUsage(usage, hypothesized.answer.usage);

  if (hypothesized.answer.stopReason === 'error') {
    return { answer: hypothesized.answer, attempts: [], ledger: [], ledgered: true, aborted: true };
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
      block,
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

  return { answer: last, attempts, ledger, ledgered: hypothesized.source !== 'none', aborted: false };
}

/** the hypothesizer turn: rank what could be wrong, record nothing else */
async function hypothesize({ record, change, block, shared, trajectory }) {
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
    caseId: record.id,
    instructions: [reviewFraming(record), '', ledgerContract()].join('\n'),
    tools,
    task: [
      change,
      ...notes(block),
      '',
      'Do not write a test and do not decide the review. Rank what could be wrong with this change',
      'and record the ledger.',
    ].join('\n'),
    maxSteps: HYPOTHESIZER_STEPS,
  });

  const fromText = recorded ? null : parseLedger(answer.text);
  const ledger = recorded ?? fromText ?? [];
  return { answer, ledger, source: recorded ? 'tool' : fromText ? 'text' : 'none' };
}

/** one prover run: the change, the whole ledger, one hypothesis to prove, the gate */
async function prove({
  record,
  workspace,
  runner,
  change,
  block,
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
    task: proverTask({ change, block, ledger, rank, abandoned }),
    maxSteps: PROVER_STEPS,
  });
}

/**
 * The memory, as the lines that go into a task. An empty memory contributes nothing at all, which
 * is what makes the memory-off arm and a run's first case identical to the shipped stage.
 */
function notes(block) {
  return block ? ['', block] : [];
}

/** the change under review, framed once and reused by every role */
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

/** what the single reviewer is told about the gate (stage-1 shape) */
function gateContract(runner) {
  return [
    'Before you may answer `defect: true`, your test has to pass a gate you do not control.',
    '',
    gateRules(runner, MAX_GATE_ATTEMPTS),
    '',
    'Answer `defect: false` at any point, with no gate attempt at all, if the change is an',
    'equivalent refactor. If you claim a defect and never pass the gate, the review is recorded as',
    'no verdict: an unproved claim is worth nothing here.',
    '',
    'When the gate passes, answer with the verdict JSON, using exactly the test that passed.',
  ].join('\n');
}

/** what the hypothesizer is asked for, and what an empty answer means (stage-2 shape) */
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

/** what the prover is told: the gate, over one hypothesis at a time (stage-2 shape) */
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

/** the prover's task: the change, the notes, the ledger, its entry, and what earlier entries cost */
function proverTask({ change, block, ledger, rank, abandoned }) {
  const lines = [change, ...notes(block), '', 'The first reviewer ranked these candidate defects:', ''];
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

/** how the run resolved, as `settle` just recorded it — what the scribe is allowed to know */
function resolutionOf(trajectory) {
  const events = trajectory.events ?? [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].type === 'gate-outcome') return events[i].resolution ?? 'unknown';
  }
  return 'unknown';
}

/** the turn a gate attempt belongs to; several model runs share one trajectory */
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

/** a case spends several model runs; the scorer sees one usage block for the case */
function addRunUsage(total, part) {
  if (!part) return total;
  total.promptTokens += part.promptTokens ?? 0;
  total.completionTokens += part.completionTokens ?? 0;
  total.totalTokens += part.totalTokens ?? 0;
  if (typeof part.costUsd === 'number') total.costUsd = (total.costUsd ?? 0) + part.costUsd;
  return total;
}
