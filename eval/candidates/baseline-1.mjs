import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent } from '../../src/agent-loop.mjs';
import { changeUnderReview, reviewInstructions } from '../prompt.mjs';

export const id = 'baseline-1';
export const description = 'one direct prompt, no tools, single completion';

/**
 * Stage 0: read the change, answer. No tools, no execution, one model turn — `maxSteps: 1` in a
 * loop that would otherwise iterate. Whatever this scores is what review without verification is
 * worth on this corpus.
 *
 * @param {object} options
 * @param {import('../../corpus/case-edit.mjs').CaseRecord} options.record
 * @param {import('../workspace.mjs').Workspace} options.workspace
 * @param {{write: Function}} options.trajectory
 * @param {string} options.model
 * @param {string} options.apiKey
 */
export async function run({ record, workspace, trajectory, model, apiKey, requestExtras = {} }) {
  const { entry, diff } = changeUnderReview(record);
  const source = readFileSync(join(workspace.mutant, entry), 'utf8');

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
    'Review this change. Is it correct? If it is wrong, provide a runnable test that catches it.',
  ].join('\n');

  return runAgent({
    caseId: record.id,
    model,
    instructions: reviewInstructions(record),
    tools: [],
    task,
    trajectory,
    maxSteps: 1,
    apiKey,
    extraBody: { usage: { include: true }, ...requestExtras },
  });
}
