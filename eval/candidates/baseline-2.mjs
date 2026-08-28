import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { runAgent } from '../../src/agent-loop.mjs';
import { capture } from '../../corpus/exec.mjs';
import { changeUnderReview, reviewInstructions } from '../prompt.mjs';
import { isInside } from '../workspace.mjs';

export const id = 'baseline-2';
export const description = 'scaffold loop with read-file and run-command, no verification contract';

const COMMAND_TIMEOUT_MS = 60_000;
const MAX_TOOL_OUTPUT = 8000;
const MAX_STEPS = 12;

/**
 * Stage 0b: the same review, with the machinery to check itself and nothing telling it to. It can
 * read either checkout and run commands in them; whether it does, and whether it believes what
 * comes back, is the measurement.
 *
 * @param {object} options
 * @param {import('../../corpus/case-edit.mjs').CaseRecord} options.record
 * @param {import('../workspace.mjs').Workspace} options.workspace
 * @param {{write: Function}} options.trajectory
 * @param {string} options.model
 * @param {string} options.apiKey
 */
export async function run({ record, workspace, trajectory, model, apiKey }) {
  const { entry, suite, diff } = changeUnderReview(record);
  const roots = [workspace.pristine, workspace.mutant];

  const task = [
    'Two checkouts of the library are on disk:',
    '',
    `- \`${workspace.mutant}\` — the change applied`,
    `- \`${workspace.pristine}\` — the original, for comparison`,
    '',
    `The change is to \`${entry}\`; each checkout's suite runs with \`${suite}\` from its root.`,
    'Here is the diff:',
    '',
    '```diff',
    diff,
    '```',
    '',
    'Review this change. Is it correct? If it is wrong, provide a runnable test that catches it.',
  ].join('\n');

  const tools = [
    {
      name: 'read-file',
      description:
        'Read a UTF-8 file from either checkout. Absolute paths, or paths relative to the ' +
        'changed checkout.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'file to read' } },
        required: ['path'],
      },
      execute: ({ path }) => {
        const target = isAbsolute(path ?? '') ? path : resolve(workspace.mutant, path ?? '');
        if (!isInside(target, roots)) throw new Error(`path is outside the checkouts: ${path}`);
        if (statSync(target).isDirectory()) throw new Error(`${path} is a directory`);
        return clip(readFileSync(target, 'utf8'));
      },
    },
    {
      name: 'run-command',
      description:
        'Run a shell command inside one of the checkouts and get its exit code and output. ' +
        `Times out after ${COMMAND_TIMEOUT_MS / 1000}s.`,
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'shell command' },
          cwd: { type: 'string', description: 'absolute path of the checkout to run it in' },
        },
        required: ['command', 'cwd'],
      },
      execute: ({ command, cwd }) => {
        const dir = isAbsolute(cwd ?? '') ? cwd : resolve(workspace.mutant, cwd ?? '.');
        if (!isInside(dir, roots)) throw new Error(`cwd is outside the checkouts: ${cwd}`);
        const result = capture(command, dir, { timeoutMs: COMMAND_TIMEOUT_MS });
        return `exit ${result.code}\n${clip(result.output)}`;
      },
    },
  ];

  return runAgent({
    caseId: record.id,
    model,
    instructions: reviewInstructions(record),
    tools,
    task,
    trajectory,
    maxSteps: MAX_STEPS,
    apiKey,
    extraBody: { usage: { include: true } },
  });
}

/** keep a tool result inside the context budget, from the end, where failures print */
function clip(text) {
  if (text.length <= MAX_TOOL_OUTPUT) return text;
  return `…[${text.length - MAX_TOOL_OUTPUT} characters trimmed]\n${text.slice(-MAX_TOOL_OUTPUT)}`;
}
