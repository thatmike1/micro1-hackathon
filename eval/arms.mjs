/**
 * What the scoreboard puts side by side, and what `CHANGELOG.md` says about each of it.
 *
 * An arm is one candidate on one engine at one configuration, measured over k repetitions. The
 * registry is declarative on purpose: the scoreboard aggregates committed runs and has no opinion
 * about which of them belong together, so the grouping, the case slice each engine is measured
 * over, and the shipped configuration are all stated here rather than inferred from directory
 * names.
 *
 * Each arm also carries the `CHANGELOG.md` row's own numbers, worded the way the row words them.
 * That is what makes the scoreboard checkable: it recomputes every one of them from `runs/` and
 * prints the disagreements instead of quietly agreeing. A claim encoded here is never edited to
 * match what the runs produced — a disagreement is a result.
 */

/**
 * The two engines, and the case slice each one is measured over. The slices differ, so a number
 * from one engine is never a number from the other: `10/12` on flash and `10/12` on qwen would be
 * over different denominators and different cases, and the scoreboard keeps them in separate
 * tables for that reason.
 */
export const ENGINES = [
  {
    id: 'flash',
    label: 'flash',
    model: 'z-ai/glm-5.3-flash',
    role: 'the saturated control (row 0d)',
    slice: { label: 'all 15 cases', cases: 15, buggy: 12, controls: 3 },
    shipped: 'stage 2',
  },
  {
    id: 'qwen',
    label: 'qwen',
    model: 'qwen/qwen3-30b-a3b-instruct-2507',
    role: 'the frontier tier (row 0d)',
    slice: { label: 'the 12 ms+bytes cases', cases: 12, buggy: 10, controls: 2 },
    shipped: 'stage 1',
  },
];

/**
 * The arms, in the order the ladder was climbed.
 *
 * - `track: 'single'` is a k=1 row measured before the engine pins existed. It is reported apart
 *   from the k=3 ladder because a single draw at an unpinned configuration is not comparable with
 *   a reliability number: row 0's `12/12` is the same arm as row 0f's `7/12` (`docs/repro.md`,
 *   "the noise floor").
 * - `track: 'ladder'` is the k=3 progression, each arm's delta taken against `against`.
 * - `track: 'ablation'` is row 3's memory on/off pair, whose delta is taken against its own off
 *   arm and never against rows 1 and 2: both off arms re-measure an unchanged candidate and land
 *   a case below the row they re-measure.
 *
 * @typedef {object} Arm
 * @property {string} id
 * @property {string} label how the arm prints
 * @property {string} code the column head it gets in a per-case matrix, where a full label would
 *   push the table past the page
 * @property {string} prefix the run directories are `runs/<prefix>-rep<n>`, or `runs/<prefix>*` at k=1
 * @property {string} engine an {@link ENGINES} id
 * @property {'single'|'ladder'|'ablation'} track
 * @property {string} row the `CHANGELOG.md` row this arm was measured for
 * @property {string|null} against the arm id its delta is taken against
 * @property {boolean} [shipped] the configuration that ships on this engine
 * @property {object[]} claims what a `CHANGELOG.md` row states about it
 */
export const ARMS = [
  {
    id: 'baseline-1-flash-k1',
    label: 'baseline 1',
    code: 'b1·k1',
    prefix: 'stage0-baseline-1-',
    engine: 'flash',
    track: 'single',
    row: '0',
    against: null,
    claims: [
      { row: '0', single: [12], falseAlarms: [0], costUsd: 0.0478, tokens: '212k', wallMin: 6.4 },
    ],
  },
  {
    id: 'baseline-2-flash-k1',
    label: 'baseline 2',
    code: 'b2·k1',
    prefix: 'stage0-baseline-2-',
    engine: 'flash',
    track: 'single',
    row: '0b',
    against: null,
    claims: [
      { row: '0b', single: [9], falseAlarms: [0], costUsd: 0.0358, tokens: '466k', wallMin: 13.8 },
    ],
  },
  {
    id: 'baseline-1-flash',
    label: 'baseline 1',
    code: 'b1',
    prefix: 'day2-baseline-1-flash',
    engine: 'flash',
    track: 'ladder',
    row: '0f',
    against: null,
    claims: [{ row: '0f', single: [11, 11, 9], all: 7, falseAlarms: [0, 0, 0] }],
  },
  {
    id: 'baseline-2-flash',
    label: 'baseline 2',
    code: 'b2',
    prefix: 'day2-baseline-2-flash',
    engine: 'flash',
    track: 'ladder',
    row: '0f',
    against: 'baseline-1-flash',
    claims: [{ row: '0f', single: [5, 7, 11], all: 3, flips: 8 }],
  },
  {
    id: 'stage-1-flash',
    label: 'stage 1',
    code: 's1',
    prefix: 'stage1-flash',
    engine: 'flash',
    track: 'ladder',
    row: '1',
    against: 'baseline-1-flash',
    claims: [
      {
        row: '1',
        single: [11, 12, 11],
        all: 10,
        falseAlarms: [0, 0, 0],
        claimUnproved: [0, 0, 0],
      },
    ],
  },
  {
    id: 'stage-2-flash',
    label: 'stage 2',
    code: 's2',
    prefix: 'stage2-flash',
    engine: 'flash',
    track: 'ladder',
    row: '2',
    against: 'stage-1-flash',
    shipped: true,
    claims: [
      {
        row: '2',
        single: [12, 12, 12],
        all: 12,
        falseAlarms: [0, 0, 0],
        flips: 0,
        noVerdict: [0, 0, 0],
        costUsd: 0.0613,
      },
    ],
  },

  {
    id: 'baseline-1-qwen',
    label: 'baseline 1',
    code: 'b1',
    prefix: 'day2-baseline-1-qwen',
    engine: 'qwen',
    track: 'ladder',
    row: '0f',
    against: null,
    claims: [
      // row 0f words this arm's controls as a single figure, with no repetition qualifying it
      { row: '0f', single: [5, 5, 5], all: 5, misses: [0, 0, 0], falseAlarms: [2, 2, 2] },
      // row 1 quotes the same arm's controls again, per repetition, while arguing stage 1 against it
      { row: '1', falseAlarms: [2, 2, 0] },
    ],
  },
  {
    id: 'baseline-2-qwen',
    label: 'baseline 2',
    code: 'b2',
    prefix: 'day2-baseline-2-qwen',
    engine: 'qwen',
    track: 'ladder',
    row: '0f',
    against: 'baseline-1-qwen',
    claims: [{ row: '0f', single: [4, 5, 2], all: 2, missesEachAtLeast: 1 }],
  },
  {
    id: 'stage-1-qwen',
    label: 'stage 1',
    code: 's1',
    prefix: 'stage1-qwen',
    engine: 'qwen',
    track: 'ladder',
    row: '1',
    against: 'baseline-1-qwen',
    shipped: true,
    claims: [
      { row: '1', single: [5, 6, 5], all: 4, falseAlarms: [0, 0, 0], claimUnproved: [0, 0, 0] },
      // row 2 quotes stage 1's misses per repetition while arguing stage 2 against it
      { row: '2', misses: [3, 1, 2] },
    ],
  },
  {
    id: 'stage-2-qwen',
    label: 'stage 2',
    code: 's2',
    prefix: 'stage2-qwen',
    engine: 'qwen',
    track: 'ladder',
    row: '2',
    against: 'stage-1-qwen',
    claims: [
      {
        row: '2',
        single: [4, 4, 5],
        all: 3,
        falseAlarms: [0, 0, 0],
        noVerdict: [0, 0, 0],
        misses: [6, 6, 5],
        costUsd: 0.0407,
      },
    ],
  },

  {
    id: 'stage-3-flash-off',
    label: 'stage 3 off',
    code: 's3off',
    prefix: 'stage3-flash-off',
    engine: 'flash',
    track: 'ablation',
    row: '3',
    against: null,
    claims: [
      { row: '3', single: [12, 12, 11], all: 11, falseAlarms: [0, 0, 0], costUsd: 0.0721 },
    ],
  },
  {
    id: 'stage-3-flash-on',
    label: 'stage 3 on',
    code: 's3on',
    prefix: 'stage3-flash-on',
    engine: 'flash',
    track: 'ablation',
    row: '3',
    against: 'stage-3-flash-off',
    claims: [
      {
        row: '3',
        single: [12, 11, 12],
        all: 11,
        falseAlarms: [0, 0, 0],
        controlNoVerdicts: 1,
        costUsd: 0.0816,
      },
    ],
  },
  {
    id: 'stage-3-qwen-off',
    label: 'stage 3 off',
    code: 's3off',
    prefix: 'stage3-qwen-off',
    engine: 'qwen',
    track: 'ablation',
    row: '3',
    against: null,
    claims: [{ row: '3', single: [6, 3, 6], all: 3, falseAlarms: [0, 0, 0], flips: 6, costUsd: 0.0927 }],
  },
  {
    id: 'stage-3-qwen-on',
    label: 'stage 3 on',
    code: 's3on',
    prefix: 'stage3-qwen-on',
    engine: 'qwen',
    track: 'ablation',
    row: '3',
    against: 'stage-3-qwen-off',
    claims: [{ row: '3', single: [3, 5, 1], all: 0, falseAlarms: [0, 0, 0], flips: 9, costUsd: 0.1242 }],
  },
];

/** @param {string} id @returns {Arm} */
export function armById(id) {
  const arm = ARMS.find((a) => a.id === id);
  if (!arm) throw new Error(`no arm ${id} in eval/arms.mjs`);
  return arm;
}

/** @param {string} id @returns {typeof ENGINES[number]} */
export function engineById(id) {
  const engine = ENGINES.find((e) => e.id === id);
  if (!engine) throw new Error(`no engine ${id} in eval/arms.mjs`);
  return engine;
}
