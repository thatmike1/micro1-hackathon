import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent } from '../../src/agent-loop.mjs';
import { changeUnderReview, reviewInstructions } from '../prompt.mjs';

export const id = 'baseline-1-nodiff';
export const description = 'baseline 1 with the post-change file only, no diff';

/**
 * The sweep's ablation arm: baseline 1 with the diff removed. Same instructions, same verdict
 * contract, same single turn — the only difference is that the file arrives without a pointer at
 * the changed span, so the model has to find the defect by reading the code rather than by
 * reading the change.
 *
 * It doubles as a contamination probe. These are popular libraries whose source is very likely in
 * training data, so a model that answers correctly here may be recalling the pristine file rather
 * than reasoning about the one in front of it.
 *
 * @param {object} options
 * @param {import('../../corpus/case-edit.mjs').CaseRecord} options.record
 * @param {import('../workspace.mjs').Workspace} options.workspace
 * @param {{write: Function}} options.trajectory
 * @param {string} options.model
 * @param {string} options.apiKey
 */
export async function run({ record, workspace, trajectory, model, apiKey }) {
  const { entry } = changeUnderReview(record);
  const source = readFileSync(join(workspace.mutant, entry), 'utf8');

  const task = [
    `A recent change may have introduced a defect in \`${entry}\`. The change itself is not`,
    'available; here is the file as it stands after it:',
    '',
    '```javascript',
    source,
    '```',
    '',
    'Review this file. Is it correct? If it is wrong, provide a runnable test that catches it.',
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
    extraBody: { usage: { include: true } },
  });
}
