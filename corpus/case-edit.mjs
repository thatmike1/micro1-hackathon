import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORPUS_DIR } from './libraries.mjs';

export const CASES_DIR = join(CORPUS_DIR, 'cases');

/**
 * A case is a single contiguous replacement over the pristine entry module, whether it came
 * from a Stryker mutant or was hand-written as an equivalent-refactor control. `mutation.diff`
 * is derived from this record, so `case.json` stays the source of truth and the diff can always
 * be regenerated with `corpus/make-case.mjs`.
 *
 * @typedef {object} Position
 * @property {number} line 1-based
 * @property {number} column 1-based
 *
 * @typedef {object} Mutation
 * @property {string} mutator Stryker mutator name, or `HandWritten` for controls
 * @property {{start: Position, end: Position}} location span in the pristine entry, end exclusive
 * @property {string} original exact text currently spanning `location`, checked before splicing
 * @property {string} replacement text written in its place
 *
 * @typedef {object} CaseRecord
 * @property {string} id
 * @property {'buggy'|'control'} kind
 * @property {string} library
 * @property {string} tag
 * @property {string} file entry module the mutation applies to, relative to the checkout
 * @property {string} category
 * @property {string} source where the mutation came from
 * @property {Mutation} mutation
 * @property {string|null} distinguishingInput probe input that separates the builds; null for controls
 * @property {{pristine: string, mutant: string}|null} expected rendered probe observations
 * @property {string} note
 */

/**
 * Byte offset of a 1-based line/column position in `source`.
 * @param {string[]} lines
 * @param {Position} position
 */
function offset(lines, position) {
  let index = 0;
  for (let i = 0; i < position.line - 1; i += 1) index += lines[i].length + 1;
  return index + position.column - 1;
}

/**
 * Apply a case's recorded replacement to the pristine source, asserting that the span still
 * holds the text the case says it does.
 *
 * @param {string} source pristine entry module
 * @param {Mutation} mutation
 * @returns {string}
 */
export function applyMutation(source, mutation) {
  const lines = source.split('\n');
  const start = offset(lines, mutation.location.start);
  const end = offset(lines, mutation.location.end);
  const found = source.slice(start, end);
  if (found !== mutation.original) {
    throw new Error(
      `mutation location does not match recorded original\n  expected: ${JSON.stringify(mutation.original)}\n  found:    ${JSON.stringify(found)}`,
    );
  }
  return source.slice(0, start) + mutation.replacement + source.slice(end);
}

/**
 * Every case on disk, in id order.
 * @returns {CaseRecord[]}
 */
export function loadCases() {
  return readdirSync(CASES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => JSON.parse(readFileSync(join(CASES_DIR, e.name, 'case.json'), 'utf8')))
    .sort((a, b) => a.id.localeCompare(b.id));
}
