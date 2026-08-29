import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runAgent } from '../src/agent-loop.mjs';
import { diagnose } from './gate.mjs';

/**
 * The cross-case memory: one written file of lessons per run, carried from case to case.
 *
 * A run is one repetition over one case slice. The file starts empty, every case reads whatever
 * is in it before the review starts, and a scribe turn appends what that case taught after the
 * review has settled. Nothing crosses run boundaries, so each repetition is still an independent
 * measurement of the same arm.
 *
 * What the scribe is allowed to know matters more than the format. It sees the change, what the
 * review did with it and how the gate answered — never `record.kind`, never the scorer's outcome.
 * The memory is written from the review's own evidence, so a lesson can be wrong, and a wrong
 * lesson is part of what the ablation measures.
 */

/** file the memory lives in, beside the run's trajectories */
export const MEMORY_FILE = 'memory.md';
/** lessons one case may append; a case that taught nothing appends none */
export const MAX_LESSONS = 3;
/** a lesson is one sentence, and is cut here if it is not */
const LESSON_CHARS = 300;
/** read budget for the block a review is shown, oldest blocks dropped first */
const MAX_BLOCK_CHARS = 6000;
/** how much of a submitted test the scribe is shown */
const TEST_CHARS = 1500;
/** the scribe's tool call plus its closing turn */
const SCRIBE_STEPS = 3;

const HEADER = '# lessons from this review queue\n';

/** the memory file for a run, derived from where its trajectories are being written */
export function defaultMemoryPath(trajectory) {
  return join(dirname(trajectory.path ?? MEMORY_FILE), MEMORY_FILE);
}

/** @returns {{text: string, entries: number}} an empty memory, as a run's first case sees it */
export function emptyMemory() {
  return { text: '', entries: 0 };
}

/**
 * Read the memory as it stands, trimmed to the read budget by dropping the oldest case blocks.
 *
 * @param {string} path
 * @returns {{text: string, entries: number}} `text` is what a review is shown, `entries` the
 *   number of case blocks behind it
 */
export function readMemory(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return emptyMemory();
  }

  const blocks = raw
    .split(/\n(?=## )/)
    .map((block) => block.trim())
    .filter((block) => block.startsWith('## '));
  if (blocks.length === 0) return emptyMemory();

  const kept = [];
  let chars = 0;
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    chars += blocks[i].length + 2;
    if (chars > MAX_BLOCK_CHARS && kept.length > 0) break;
    kept.unshift(blocks[i]);
  }
  return { text: kept.join('\n\n'), entries: kept.length };
}

/**
 * The memory as a block of prompt, or `''` when there is nothing yet. An empty memory has to
 * render as nothing at all: the first case of a memory-on run and every case of a memory-off run
 * must see the same prompt the shipped stage sends, or the ablation is measuring two changes.
 *
 * @param {{text: string}} memory
 */
export function memoryBlock(memory) {
  if (!memory.text) return '';
  return [
    'Notes you wrote while reviewing earlier changes in this same queue, oldest first. They are',
    'your own lessons from other changes to other files, not facts about this one, and no one has',
    'checked them. Use what applies and ignore what does not.',
    '',
    '```markdown',
    memory.text,
    '```',
  ].join('\n');
}

/**
 * Append one case's block. Written even when the lessons list is empty, so the file records that
 * the case was reviewed and taught nothing rather than looking as though it never ran.
 *
 * @param {string} path
 * @param {{caseId: string, library: string, resolution: string, lessons: string[]}} entry
 */
export function appendMemory(path, { caseId, library, resolution, lessons }) {
  mkdirSync(dirname(path), { recursive: true });
  let head = '';
  try {
    readFileSync(path, 'utf8');
  } catch {
    head = `${HEADER}`;
  }
  const body = lessons.length === 0 ? ['- (nothing new)'] : lessons.map((lesson) => `- ${lesson}`);
  appendFileSync(path, `${head}\n## ${caseId} (${library}) — ${resolution}\n${body.join('\n')}\n`);
}

/**
 * The scribe turn: read what this review did and write down what the next one should know.
 *
 * It runs after the verdict has settled and cannot change it. Its only tool stores strings.
 *
 * @param {object} options
 * @param {import('../corpus/case-edit.mjs').CaseRecord} options.record
 * @param {string} options.path memory file
 * @param {{text: string}} options.memory the memory as this case read it
 * @param {string} options.diff
 * @param {{resolution: string, attempts: object[], ledger: object[]}} options.review
 * @param {object} options.shared model, apiKey, trajectory, transport, extraBody
 * @param {{write: Function}} options.trajectory
 * @returns {Promise<import('../src/trajectory.mjs').Usage|null>} the scribe's own usage
 */
export async function writeLessons({ record, path, memory, diff, review, shared, trajectory }) {
  /** @type {string[] | null} */
  let recorded = null;

  const tools = [
    {
      name: 'append-lessons',
      description:
        `Append at most ${MAX_LESSONS} lessons to the queue's notebook, each one sentence. ` +
        'Pass an empty list if this review taught nothing that transfers. This tool only stores ' +
        'text; it runs nothing and it cannot change the verdict.',
      parameters: {
        type: 'object',
        properties: {
          lessons: {
            type: 'array',
            description: `at most ${MAX_LESSONS} one-sentence lessons; empty if there is nothing worth carrying`,
            items: { type: 'string' },
          },
        },
        required: ['lessons'],
      },
      execute: ({ lessons }) => {
        if (!Array.isArray(lessons)) throw new Error('lessons must be a list, empty if there is nothing to carry');
        recorded = lessons
          .filter((lesson) => typeof lesson === 'string')
          .map((lesson) => lesson.trim().replace(/\s+/g, ' ').slice(0, LESSON_CHARS))
          .filter((lesson) => lesson !== '')
          .slice(0, MAX_LESSONS);
        return recorded.length === 0
          ? 'Nothing appended. Stop.'
          : `${recorded.length} lesson(s) appended to the notebook. Stop.`;
      },
    },
  ];

  const answer = await runAgent({
    ...shared,
    caseId: `${record.id}#memory`,
    instructions: scribeContract(),
    tools,
    task: scribeTask({ record, memory, diff, review }),
    maxSteps: SCRIBE_STEPS,
  });

  const lessons = recorded ?? [];
  appendMemory(path, {
    caseId: record.id,
    library: record.library,
    resolution: review.resolution,
    lessons,
  });
  trajectory.write('memory-write', {
    file: path,
    lessons,
    recorded: recorded !== null,
    usage: answer.usage,
  });
  return answer.usage ?? null;
}

/** what the scribe is for, and what a lesson has to be to be worth writing down */
function scribeContract() {
  return [
    "You keep the notebook for a queue of code reviews. One change has just been reviewed and you",
    'write down what the next review should know before it starts.',
    '',
    'Write only what transfers. A lesson is about the library, about the kind of change this queue',
    'keeps producing, or about what it takes to write a test that separates two builds — something',
    "that would still be useful on a different change to a different file. \"ms('1y') is 365 days,",
    'not a calendar year" transfers. "This case was a defect" does not, and neither does anything',
    'that only names this file or this line.',
    '',
    'You are not told whether the review reached the right answer, and you must not write down a',
    'conclusion it did not reach. If the gate rejected every test, the lesson is what the rejection',
    'showed about the library or about the test, not that the change is clean.',
    '',
    'Do not repeat a lesson the notebook already holds.',
    '',
    `Call \`append-lessons\` once with at most ${MAX_LESSONS} lessons, then stop. An empty list is`,
    'the right answer when this review taught nothing new.',
  ].join('\n');
}

/** the case as the scribe sees it: the change, what the review did, how the gate answered */
function scribeTask({ record, memory, diff, review }) {
  const lines = [
    `The review of \`${record.id}\` (\`${record.library}\` at ${record.tag}) has finished.`,
    '',
    'The change that was reviewed:',
    '',
    '```diff',
    diff.trim(),
    '```',
    '',
  ];

  if (review.ledger && review.ledger.length > 0) {
    lines.push('The reviewer ranked these candidate defects:', '');
    review.ledger.forEach((entry, i) => {
      lines.push(`${i + 1}. ${entry.claim}`);
      lines.push(`   input: ${entry.input}   expected: ${entry.expected}   on the changed build: ${entry.observed}`);
    });
    lines.push('');
  } else if (review.ledger) {
    lines.push('The reviewer ranked no candidate defects at all: it recorded an empty ledger.', '');
  }

  if (review.attempts.length === 0) {
    lines.push('No test was ever submitted to the gate.', '');
  } else {
    lines.push('What the gate did with each submitted test (exit codes are changed/original):', '');
    for (const attempt of review.attempts) {
      const rank = attempt.hypothesis ? ` for hypothesis ${attempt.hypothesis}` : '';
      lines.push(
        `- attempt ${attempt.attempt}${rank}: ${attempt.result.mutant.code}/${attempt.result.pristine.code} — ` +
          (attempt.passed ? 'PASSED, it separates the two builds' : diagnose(attempt.result)),
      );
    }
    const shown = review.attempts.find((a) => a.passed) ?? review.attempts.at(-1);
    lines.push(
      '',
      attemptLabel(shown),
      '',
      '```javascript',
      shown.content.slice(0, TEST_CHARS),
      '```',
      '',
    );
  }

  lines.push(`The review ended as: ${review.resolution}.`, '');

  if (memory.text) {
    lines.push('The notebook already holds:', '', '```markdown', memory.text, '```', '');
  } else {
    lines.push('The notebook is empty; this is the first review in the queue.', '');
  }

  lines.push('Write what the next review should know.');
  return lines.join('\n');
}

function attemptLabel(attempt) {
  return attempt.passed ? 'The test that passed the gate:' : 'The last test it submitted:';
}
