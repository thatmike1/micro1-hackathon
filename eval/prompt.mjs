import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CASES_DIR } from '../corpus/case-edit.mjs';
import { library } from '../corpus/libraries.mjs';
import { proofRunner } from './workspace.mjs';

/**
 * The output contract every candidate answers under. It is not a verification contract: it says
 * what shape the answer takes, never that the candidate must run anything. Stage 1 is where a
 * candidate is required to prove its claim before answering.
 *
 * @param {import('../corpus/case-edit.mjs').CaseRecord} record
 */
export function verdictContract(record) {
  const runner = proofRunner(record.library);
  return [
    'Answer with exactly one JSON object, inside a ```json fence, as the last thing you write:',
    '',
    '```json',
    '{"defect": true, "testFile": {"path": "<path>", "content": "<test source>"}, "note": "<one or two sentences>"}',
    '```',
    '',
    '- `defect`: true if the change alters behaviour a caller can observe, false if it is an',
    '  equivalent refactor.',
    '- `testFile`: required when `defect` is true, omitted when it is false. Its `content` is a',
    '  complete, runnable test file, JSON-escaped as a single string.',
    `- The file is written to \`${runner.path}\` in the checkout and run with \`${runner.command}\`,`,
    '  so it must import the library exactly as the skeleton below does:',
    '',
    '```',
    runner.template,
    '```',
  ].join('\n');
}

/**
 * The change under review: the library's file as it stands after the change, plus the diff that
 * produced it. Neither says which of the two it is, and the corpus mixes real defects with
 * equivalent refactors, so the candidate has to decide.
 *
 * @param {import('../corpus/case-edit.mjs').CaseRecord} record
 */
export function changeUnderReview(record) {
  const lib = library(record.library);
  const diff = readFileSync(join(CASES_DIR, record.id, 'mutation.diff'), 'utf8');
  return { entry: lib.entry, suite: lib.test, diff };
}

/**
 * What every candidate is told about the library and the change, with no output contract attached:
 * what the library is, that the suite is green either way, and that the queue mixes real defects
 * with equivalent refactors.
 *
 * Split out from `reviewInstructions` because stage 2's hypothesizer answers with a ledger rather
 * than a verdict, and has to read the same framing to be comparable.
 *
 * @param {import('../corpus/case-edit.mjs').CaseRecord} record
 */
export function reviewFraming(record) {
  return [
    'You are reviewing a proposed change to a small, widely used JavaScript library.',
    `The library is \`${record.library}\` at tag ${record.tag}. Its own test suite`,
    `(\`${library(record.library).test}\`) passes with the change applied, so a green suite is not`,
    'evidence that the change is correct.',
    '',
    'Decide whether the change breaks behaviour a caller can observe. Some changes in this review',
    'queue are equivalent refactors with no behavioural difference at all.',
  ].join('\n');
}

/**
 * Shared framing for both baselines: the framing above plus the verdict contract.
 *
 * @param {import('../corpus/case-edit.mjs').CaseRecord} record
 */
export function reviewInstructions(record) {
  return [reviewFraming(record), '', verdictContract(record)].join('\n');
}
