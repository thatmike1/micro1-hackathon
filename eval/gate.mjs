/**
 * The double-run gate, in one place.
 *
 * Stage 1 introduced it and stage 2 splits the roles around it. Both have to be measured against
 * the same gate for the comparison to mean anything, so the wording the agent reads, the failure
 * shapes it is told apart, and the pass condition all live here rather than being restated per
 * candidate. What differs between the stages is the attempt budget, which is a parameter.
 *
 * The pass condition itself is `doubleRun` in `workspace.mjs`: red on the changed checkout, green
 * on the original, exit codes and nothing else.
 */

/** stage 1's budget: one submission plus three revisions, the default the wording assumes */
export const DEFAULT_ATTEMPTS = 4;

/**
 * What the agent is told the gate does. The same bullets for every candidate; only the attempt
 * count moves.
 *
 * @param {import('./workspace.mjs').ProofRunner} runner
 * @param {number} total gate attempts available
 */
export function gateRules(runner, total = DEFAULT_ATTEMPTS) {
  return [
    `- call \`submit-proof\` with the complete source of the test file. The harness writes it to`,
    `  \`${runner.path}\` in two checkouts — one with the change applied, one an untouched`,
    `  original — runs \`${runner.command}\` in each, and reads the two exit codes.`,
    '- the gate passes only if the run on the changed checkout fails and the run on the original',
    '  passes. Green on both means your assertion does not separate the two builds. Red on both',
    '  means your test asserts something the library never did, or does not run at all.',
    "- a failed gate comes back with both runners' output. Read it, fix the test, submit again.",
    `- you get at most ${total} gate attempts in total.`,
  ].join('\n');
}

/**
 * The description the `submit-proof` tool is registered with.
 *
 * @param {import('./workspace.mjs').ProofRunner} runner
 * @param {number} total gate attempts available
 */
export function gateToolDescription(runner, total = DEFAULT_ATTEMPTS) {
  return (
    `Run a candidate test through the gate. The harness writes it to \`${runner.path}\` in ` +
    'two checkouts — one with the change applied, one untouched original — runs ' +
    `\`${runner.command}\` in each, and reads the two exit codes. The gate passes only if the ` +
    'run on the changed checkout fails and the run on the original passes. A failure comes ' +
    `back with both runners' output. At most ${total} attempts per review.`
  );
}

/**
 * The gate's reply to one submission: the two exit codes, what they mean, and both tails.
 *
 * @param {number} attempt 1-based attempt number within this budget
 * @param {ReturnType<import('./workspace.mjs').doubleRun>} result
 * @param {number} total gate attempts available
 */
export function formatGate(attempt, result, total = DEFAULT_ATTEMPTS) {
  const left = total - attempt;
  const codes = [
    `changed checkout : exit ${result.mutant.code} (${result.mutant.code === 0 ? 'passed' : 'failed'})`,
    `original checkout: exit ${result.pristine.code} (${result.pristine.code === 0 ? 'passed' : 'failed'})`,
  ].join('\n');

  if (result.proved) {
    return [
      `GATE PASSED on attempt ${attempt} of ${total}.`,
      codes,
      '',
      'The test separates the two builds. Answer with the verdict JSON now, carrying this exact',
      'test file as `testFile.content`.',
    ].join('\n');
  }

  return [
    `GATE FAILED on attempt ${attempt} of ${total}. ${left} attempt(s) left.`,
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
export function diagnose(result) {
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

/** the exit-code pair of one attempt, as it reads in a ledger note or an audit cell */
export function codePair(result) {
  return `${result.mutant.code}/${result.pristine.code}`;
}
