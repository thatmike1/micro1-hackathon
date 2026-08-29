import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent } from '../../src/agent-loop.mjs';
import { changeUnderReview, reviewInstructions } from '../prompt.mjs';
import { parseVerdict } from '../verdict.mjs';
import { doubleRun, proofRunner } from '../workspace.mjs';

export const id = 'stage-1';
export const description = 'prover loop: a claimed defect stands only once its test clears the double-run gate';

/** first submission plus three revisions */
const MAX_GATE_ATTEMPTS = 4;
/** enough turns for four gate attempts, the final answer, and a little slack */
const MAX_STEPS = 10;
const GATE_TIMEOUT_MS = 60_000;
/**
 * Completion cap. Three qwen generations in the stage-0 k=3 arms degenerated into a repetition
 * loop and ran to the provider's 65,536-token default at ~$0.02 and ~10 minutes each; a cap turns
 * that into a fast no-verdict. Deliberately not retrofitted into the stage-0 arms, whose numbers
 * were measured without it. `requestExtras` still wins, so a run can record its own value.
 */
const MAX_TOKENS = 4096;

/**
 * Stage 1: the same information baseline 1 had — the changed file and the diff — plus one thing it
 * did not have, a gate it does not control. The agent writes a candidate test and submits it; the
 * harness materialises that test in both checkouts, runs the library's own runner in each, and
 * reads the exit codes and nothing else. Red on the mutant and green on pristine passes. Any other
 * pair fails, and the failure comes back to the agent as both runners' output so it can revise,
 * up to three times.
 *
 * The gate, not the model's prose, decides the answer this candidate returns:
 *
 * - a passed gate is answered as a defect, carrying the exact test that passed
 * - `defect: false` from the agent stands as-is when no gate attempt ever passed
 * - a defect claim that never passed the gate is withheld — the run is a no-verdict
 *
 * @param {object} options
 * @param {import('../../corpus/case-edit.mjs').CaseRecord} options.record
 * @param {import('../workspace.mjs').Workspace} options.workspace
 * @param {{write: Function}} options.trajectory
 * @param {string} options.model
 * @param {string} options.apiKey
 */
export async function run({ record, workspace, trajectory, model, apiKey, requestExtras = {}, transport }) {
  const { entry, diff } = changeUnderReview(record);
  const source = readFileSync(join(workspace.mutant, entry), 'utf8');
  const runner = proofRunner(record.library);

  /** @type {{attempt: number, passed: boolean, content: string, result: object}[]} */
  const attempts = [];

  const task = [
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
    '',
    'Review this change. Is it correct? If it is wrong, prove it with `submit-proof` before you',
    'answer.',
  ].join('\n');

  const tools = [
    {
      name: 'submit-proof',
      description:
        `Run a candidate test through the gate. The harness writes it to \`${runner.path}\` in ` +
        'two checkouts — one with the change applied, one untouched original — runs ' +
        `\`${runner.command}\` in each, and reads the two exit codes. The gate passes only if the ` +
        'run on the changed checkout fails and the run on the original passes. A failure comes ' +
        `back with both runners' output. At most ${MAX_GATE_ATTEMPTS} attempts per review.`,
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

        // every attempt is on the record, so a case that failed the gate and then passed it reads
        // as the sequence it was rather than as a clean first answer
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
    caseId: record.id,
    model,
    instructions: [reviewInstructions(record), '', gateContract(runner)].join('\n'),
    tools,
    task,
    trajectory,
    maxSteps: MAX_STEPS,
    apiKey,
    ...(transport ? { transport } : {}),
    extraBody: { usage: { include: true }, max_tokens: MAX_TOKENS, ...requestExtras },
  });

  return settle(answer, attempts, runner, trajectory);
}

/**
 * Turn the loop's state into the answer the scorer sees. The gate outranks the final message:
 * a passed gate is answered as a defect whatever the model wrote last, and an unproved claim is
 * withheld rather than shipped.
 */
export function settle(answer, attempts, runner, trajectory) {
  const passed = attempts.find((a) => a.passed) ?? null;
  const parsed = parseVerdict(answer.text);
  const note = parsed.ok && parsed.verdict.note ? parsed.verdict.note : '';

  if (passed) {
    const text = [
      '```json',
      JSON.stringify({
        defect: true,
        testFile: { path: runner.path, content: passed.content },
        note:
          note ||
          `gate passed on attempt ${passed.attempt}: red on the changed checkout, green on the original`,
      }),
      '```',
    ].join('\n');
    trajectory.write('gate-outcome', {
      resolution: 'proved',
      attempts: attempts.length,
      passedOn: passed.attempt,
    });
    return { ...answer, text, stopReason: 'final', error: null };
  }

  if (parsed.ok && !parsed.verdict.defect) {
    trajectory.write('gate-outcome', { resolution: 'clean', attempts: attempts.length });
    return answer;
  }

  trajectory.write('gate-outcome', {
    resolution: 'withheld',
    attempts: attempts.length,
    reason: parsed.ok ? 'defect claimed, gate never passed' : `no parseable verdict: ${parsed.error}`,
  });
  return {
    ...answer,
    text:
      `The gate was not passed in ${attempts.length} attempt(s): no test was produced that fails ` +
      'on the changed checkout and passes on the original. The claim is withheld.',
    stopReason: 'final',
  };
}

/**
 * The turn a gate attempt belongs to, so the renderer groups it under the step that asked for it
 * rather than opening a step of its own. The writer keeps the events it has written.
 */
function currentStep(trajectory) {
  for (let i = trajectory.events.length - 1; i >= 0; i -= 1) {
    if (trajectory.events[i].type === 'step') return trajectory.events[i].step ?? null;
  }
  return null;
}

/** what the agent is told about the gate, appended to the shared review instructions */
function gateContract(runner) {
  return [
    'Before you may answer `defect: true`, your test has to pass a gate you do not control.',
    '',
    `- call \`submit-proof\` with the complete source of the test file. The harness writes it to`,
    `  \`${runner.path}\` in two checkouts — one with the change applied, one an untouched`,
    `  original — runs \`${runner.command}\` in each, and reads the two exit codes.`,
    '- the gate passes only if the run on the changed checkout fails and the run on the original',
    '  passes. Green on both means your assertion does not separate the two builds. Red on both',
    '  means your test asserts something the library never did, or does not run at all.',
    "- a failed gate comes back with both runners' output. Read it, fix the test, submit again.",
    `- you get at most ${MAX_GATE_ATTEMPTS} gate attempts in total.`,
    '',
    'Answer `defect: false` at any point, with no gate attempt at all, if the change is an',
    'equivalent refactor. If you claim a defect and never pass the gate, the review is recorded as',
    'no verdict: an unproved claim is worth nothing here.',
    '',
    'When the gate passes, answer with the verdict JSON, using exactly the test that passed.',
  ].join('\n');
}

/** the gate's reply to one submission: the two exit codes, what they mean, and both tails */
export function formatGate(attempt, result) {
  const left = MAX_GATE_ATTEMPTS - attempt;
  const codes = [
    `changed checkout : exit ${result.mutant.code} (${result.mutant.code === 0 ? 'passed' : 'failed'})`,
    `original checkout: exit ${result.pristine.code} (${result.pristine.code === 0 ? 'passed' : 'failed'})`,
  ].join('\n');

  if (result.proved) {
    return [
      `GATE PASSED on attempt ${attempt} of ${MAX_GATE_ATTEMPTS}.`,
      codes,
      '',
      'The test separates the two builds. Answer with the verdict JSON now, carrying this exact',
      'test file as `testFile.content`.',
    ].join('\n');
  }

  return [
    `GATE FAILED on attempt ${attempt} of ${MAX_GATE_ATTEMPTS}. ${left} attempt(s) left.`,
    codes,
    '',
    diagnose(result),
    '',
    '--- output on the changed checkout ---',
    result.mutant.tail || '(no output)',
    '',
    '--- output on the original checkout ---',
    result.pristine.tail || '(no output)',
  ].join('\n');
}

/** name the failure shape, so the agent revises against the right problem */
function diagnose(result) {
  const red = (side) => result[side].code !== 0;
  if (!red('mutant') && !red('pristine')) {
    return 'Green on both: the assertion holds for the original as well, so it does not touch the changed behaviour.';
  }
  if (red('mutant') && red('pristine')) {
    return 'Red on both: the test also fails on the original, so it asserts something this library never did, or it does not run (bad import, syntax error, wrong dialect).';
  }
  if (!red('mutant') && red('pristine')) {
    return 'Backwards: the test passes on the changed checkout and fails on the original. It is asserting the changed behaviour, not the correct one.';
  }
  return 'The exit codes do not show a red-on-changed, green-on-original split.';
}
