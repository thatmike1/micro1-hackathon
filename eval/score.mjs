/**
 * Scoring is separated from running so it can be tested without a model or a checkout.
 *
 * Outcomes, per case kind:
 *
 * - buggy: `proved` (test red on the mutant, green on pristine), `claim-unproved` (defect
 *   claimed, no test or the double run did not hold), `miss` (called clean)
 * - control: `correct` (called clean), `false-alarm` (defect claimed — a hard error, the
 *   agent would have sent a maintainer after an equivalent refactor)
 * - either: `no-verdict` (no parseable answer), `error` (the run itself failed)
 *
 * @typedef {'proved'|'claim-unproved'|'miss'|'correct'|'false-alarm'|'no-verdict'|'error'} Outcome
 */

/**
 * @param {'buggy'|'control'} kind
 * @param {{defect: boolean, testFile: object|null}} verdict
 * @param {{proved: boolean}|null} proof the double run, or null when it was not reached
 * @returns {Outcome}
 */
export function classify(kind, verdict, proof) {
  if (kind === 'control') return verdict.defect ? 'false-alarm' : 'correct';
  if (!verdict.defect) return 'miss';
  if (!verdict.testFile) return 'claim-unproved';
  return proof?.proved ? 'proved' : 'claim-unproved';
}

/**
 * Roll per-case results into the run's headline metrics.
 * @param {object[]} results
 */
export function totals(results) {
  const count = (kind, outcome) =>
    results.filter((r) => r.kind === kind && r.outcome === outcome).length;
  const buggy = results.filter((r) => r.kind === 'buggy').length;
  const proved = count('buggy', 'proved');
  const usage = results.reduce(
    (total, r) => ({
      promptTokens: total.promptTokens + (r.usage?.promptTokens ?? 0),
      completionTokens: total.completionTokens + (r.usage?.completionTokens ?? 0),
      totalTokens: total.totalTokens + (r.usage?.totalTokens ?? 0),
      costUsd: r.usage?.costUsd == null ? total.costUsd : (total.costUsd ?? 0) + r.usage.costUsd,
    }),
    emptyUsage(),
  );
  return {
    cases: results.length,
    buggy,
    controls: results.length - buggy,
    proved,
    proofRate: buggy === 0 ? null : proved / buggy,
    claimUnproved: count('buggy', 'claim-unproved'),
    misses: count('buggy', 'miss'),
    falseAlarms: count('control', 'false-alarm'),
    controlsCorrect: count('control', 'correct'),
    noVerdict: results.filter((r) => r.outcome === 'no-verdict').length,
    errors: results.filter((r) => r.outcome === 'error').length,
    usage,
    wallMsTotal: results.reduce((sum, r) => sum + r.wallMs, 0),
  };
}

/** @returns {import('../src/trajectory.mjs').Usage} */
export function emptyUsage() {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null };
}
