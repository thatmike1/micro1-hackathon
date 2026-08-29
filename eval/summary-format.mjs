import { readFileSync } from 'node:fs';
import { totals as recompute } from './score.mjs';

/**
 * A generation-aware reader for `runs/<dir>/summary.json`.
 *
 * The recorded fields grew as the measurement did, so three shapes are committed under `runs/`
 * (`docs/repro.md`, "reading a summary.json"): the row-0 runs predate `requestExtras` entirely;
 * the `day2-`, `stage1-` and `stage2-` runs carry it but not `candidateOptions`, `concurrency` or
 * `order`, which stage 3 added when case ordering became part of the measurement.
 *
 * Nothing below is read optionally. A scoreboard that reads a moved field as `undefined` scores
 * the run as a zero and reports that zero as a result, which is worse than not running: every
 * shape this module does not recognise throws, naming the file and what was wrong with it.
 *
 * The last check is the strongest one. `totals` is not trusted as written: it is recomputed from
 * `cases` with the shipped scorer and the two must agree, so a field that moves inside either
 * half is caught even when the top-level shape is intact.
 */

/** top-level keys every generation carries */
const BASE_KEYS = [
  'candidate',
  'description',
  'model',
  'startedAt',
  'finishedAt',
  'wallMs',
  'totals',
  'cases',
];

/** the three shapes committed under `runs/`, oldest first, by the keys each one added */
export const SUMMARY_GENERATIONS = [
  {
    generation: 1,
    adds: [],
    written_by: 'row 0 — before the engine pins existed',
  },
  {
    generation: 2,
    adds: ['requestExtras'],
    written_by: 'rows 0d–2 — pinned routing recorded, case ordering not yet part of the measurement',
  },
  {
    generation: 3,
    adds: ['requestExtras', 'candidateOptions', 'concurrency', 'order'],
    written_by: 'row 3 — the ablation needed the knobs and the order recorded too',
  },
];

/** every key any generation adds on top of {@link BASE_KEYS}, in the order they appeared */
const OPTIONAL_KEYS = SUMMARY_GENERATIONS.at(-1).adds;

/** the counts the scoreboard reads out of `totals`, and recomputes to check */
const TOTAL_COUNTS = [
  'cases',
  'buggy',
  'controls',
  'proved',
  'claimUnproved',
  'misses',
  'falseAlarms',
  'controlsCorrect',
  'noVerdict',
  'errors',
];

/** the per-case fields the scoreboard depends on */
const CASE_KEYS = ['id', 'kind', 'outcome', 'usage', 'wallMs'];

/** the outcome vocabulary, from `eval/score.mjs`. An outcome outside it is an unread result */
const OUTCOMES = new Set([
  'proved',
  'claim-unproved',
  'miss',
  'correct',
  'false-alarm',
  'no-verdict',
  'error',
]);

const KINDS = new Set(['buggy', 'control']);

/**
 * Read and validate one run's summary.
 *
 * @param {string} path to a `summary.json`
 * @returns {object} the summary, with a `generation` number and its `path` attached
 */
export function readSummary(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new Error(`${path}: cannot be read (${cause.code ?? cause.message})`, { cause });
  }
  return parseSummary(text, path);
}

/**
 * The same, from text already in hand, so the format contract is testable without a run directory.
 *
 * @param {string|object} source the JSON text, or the parsed object
 * @param {string} label how the file is named in an error message
 * @returns {object}
 */
export function parseSummary(source, label = '<summary>') {
  let summary;
  if (typeof source === 'string') {
    try {
      summary = JSON.parse(source);
    } catch (cause) {
      throw new Error(`${label}: not JSON (${cause.message})`, { cause });
    }
  } else {
    summary = source;
  }
  if (summary === null || typeof summary !== 'object' || Array.isArray(summary)) {
    throw new Error(`${label}: expected an object, got ${describe(summary)}`);
  }

  const missing = BASE_KEYS.filter((key) => !(key in summary));
  if (missing.length > 0) {
    throw new Error(
      `${label}: missing ${missing.join(', ')}. Every generation of this file carries ` +
        `${BASE_KEYS.join(', ')}; a summary without them is not a scored run.`,
    );
  }

  const generation = detectGeneration(summary, label);
  checkTotals(summary, label);
  checkCases(summary, label);
  checkTotalsAgainstCases(summary, label);

  return { ...summary, generation, path: label };
}

/**
 * Which recorded shape this is, by the optional keys present. An unknown combination is a fourth
 * generation nobody taught this reader about, and it stops here rather than being scored partly.
 *
 * @returns {number}
 */
function detectGeneration(summary, label) {
  const present = OPTIONAL_KEYS.filter((key) => key in summary);
  const match = SUMMARY_GENERATIONS.find(
    (gen) => gen.adds.length === present.length && gen.adds.every((key) => present.includes(key)),
  );
  if (match) return match.generation;

  throw new Error(
    `${label}: unrecognised summary generation. Optional keys present: ` +
      `${present.length ? present.join(', ') : 'none'}. The three shapes this repo committed are ` +
      `${SUMMARY_GENERATIONS.map((g) => `gen ${g.generation} [${g.adds.join(', ') || 'none'}]`).join('; ')}. ` +
      'Teach eval/summary-format.mjs the new shape rather than letting it score the run as a zero.',
  );
}

function checkTotals(summary, label) {
  const t = summary.totals;
  if (t === null || typeof t !== 'object') {
    throw new Error(`${label}: totals is ${describe(t)}, expected an object`);
  }
  const gaps = TOTAL_COUNTS.filter((key) => !Number.isFinite(t[key]));
  if (gaps.length > 0) {
    throw new Error(
      `${label}: totals.${gaps.join(', totals.')} ${gaps.length === 1 ? 'is' : 'are'} not a number. ` +
        'A count that reads as undefined scores as a zero, so it is refused here instead.',
    );
  }
  if (!Number.isFinite(t.usage?.totalTokens)) {
    throw new Error(`${label}: totals.usage.totalTokens is not a number`);
  }
  if (!Number.isFinite(summary.wallMs)) {
    throw new Error(`${label}: wallMs is not a number`);
  }
}

function checkCases(summary, label) {
  if (!Array.isArray(summary.cases) || summary.cases.length === 0) {
    throw new Error(`${label}: cases is ${describe(summary.cases)}, expected a non-empty array`);
  }
  summary.cases.forEach((record, i) => {
    const where = `${label}: cases[${i}]${record?.id ? ` (${record.id})` : ''}`;
    if (record === null || typeof record !== 'object') {
      throw new Error(`${where} is ${describe(record)}, expected an object`);
    }
    const gaps = CASE_KEYS.filter((key) => record[key] == null);
    if (gaps.length > 0) throw new Error(`${where}: missing ${gaps.join(', ')}`);
    if (!KINDS.has(record.kind)) {
      throw new Error(`${where}: kind ${JSON.stringify(record.kind)} is not buggy or control`);
    }
    if (!OUTCOMES.has(record.outcome)) {
      throw new Error(
        `${where}: outcome ${JSON.stringify(record.outcome)} is outside the vocabulary in ` +
          `eval/score.mjs (${[...OUTCOMES].join(', ')})`,
      );
    }
  });
}

/**
 * The headline is recomputed from the per-case records with the shipped scorer. The two disagreeing
 * means one of them moved, and the scoreboard cannot tell which, so neither is used.
 */
function checkTotalsAgainstCases(summary, label) {
  const fresh = recompute(summary.cases);
  const drift = TOTAL_COUNTS.filter((key) => fresh[key] !== summary.totals[key]).map(
    (key) => `${key} recorded ${summary.totals[key]}, cases say ${fresh[key]}`,
  );
  if (fresh.usage.totalTokens !== summary.totals.usage.totalTokens) {
    drift.push(
      `usage.totalTokens recorded ${summary.totals.usage.totalTokens}, ` +
        `cases say ${fresh.usage.totalTokens}`,
    );
  }
  if (drift.length > 0) {
    throw new Error(
      `${label}: totals do not match the cases they are over — ${drift.join('; ')}. ` +
        'Rescoring with eval/score.mjs is what settles this; the scoreboard will not pick a side.',
    );
  }
}

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}
