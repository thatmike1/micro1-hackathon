import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { loadCases } from '../corpus/case-edit.mjs';
import { pristineEntry } from '../corpus/libraries.mjs';
import { run as runStage1 } from './candidates/stage-1.mjs';
import { run as runStage2 } from './candidates/stage-2.mjs';
import { run as runStage3 } from './candidates/stage-3.mjs';
import { appendMemory, emptyMemory, memoryBlock, readMemory } from './memory.mjs';
import { prepareCase } from './workspace.mjs';

describe('the memory file', () => {
  it('renders nothing at all when it is empty, so an off arm sends the shipped prompt', () => {
    assert.equal(memoryBlock(emptyMemory()), '');
    assert.equal(memoryBlock({ text: '', entries: 0 }), '');
    assert.match(memoryBlock({ text: '## a\n- lesson', entries: 1 }), /- lesson/);
  });

  it('round-trips case blocks through the file, oldest first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'memory-'));
    const path = join(dir, 'memory.md');
    try {
      assert.deepEqual(readMemory(path), { text: '', entries: 0 });
      appendMemory(path, { caseId: 'ms-4', library: 'ms', resolution: 'proved', lessons: ['first'] });
      appendMemory(path, { caseId: 'ms-12', library: 'ms', resolution: 'clean', lessons: [] });
      const memory = readMemory(path);
      assert.equal(memory.entries, 2);
      assert.equal(
        memory.text,
        '## ms-4 (ms) — proved\n- first\n\n## ms-12 (ms) — clean\n- (nothing new)',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('drops the oldest blocks when the read budget is exceeded', () => {
    const dir = mkdtempSync(join(tmpdir(), 'memory-'));
    const path = join(dir, 'memory.md');
    try {
      for (let i = 0; i < 40; i += 1) {
        appendMemory(path, {
          caseId: `case-${i}`,
          library: 'ms',
          resolution: 'proved',
          lessons: ['x'.repeat(400)],
        });
      }
      const memory = readMemory(path);
      assert.ok(memory.entries < 40, 'the oldest blocks are dropped');
      assert.ok(memory.text.length <= 6500, `block is ${memory.text.length} chars`);
      assert.match(memory.text, /## case-39/);
      assert.doesNotMatch(memory.text, /## case-0 /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * What the ablation rests on: with the memory empty, stage 3 has to BE the shipped stage. Every
 * request body it sends is compared against the one the shipped candidate sends for the same case
 * under the same scripted model. The scripts never submit a proof, so the gate is never reached
 * and the bodies carry no runner timings to differ over.
 */
describe('stage 3 with the memory off is the shipped stage', { skip: !existsSync(pristineEntry('ms')) }, () => {
  const trace = () => {
    const events = [];
    return {
      events,
      path: join(tmpdir(), 'stage-3-equivalence', 'x.jsonl'),
      write: (type, payload) => events.push({ type, ...payload }),
    };
  };

  const reply = (message) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message, finish_reason: 'stop' }] }),
  });

  /** every request body a candidate sent, in order */
  const bodiesFrom = async (candidate, record, workspace, transport, options) => {
    const bodies = [];
    const recording = async (url, init) => {
      bodies.push(init.body);
      return transport(url, init);
    };
    await candidate({ record, workspace, trajectory: trace(), model: 'mock', transport: recording, options });
    return bodies;
  };

  it('sends stage 1 byte for byte', async () => {
    const record = loadCases().find((c) => c.id === 'ms-4');
    const workspace = await prepareCase(record);
    try {
      const transport = async () => reply({ content: '```json\n{"defect": false, "note": "equivalent"}\n```' });
      const shipped = await bodiesFrom(runStage1, record, workspace, transport);
      const off = await bodiesFrom(runStage3, record, workspace, transport, { base: 'stage-1', memory: 'off' });
      assert.equal(shipped.length, 1);
      assert.deepEqual(off, shipped);
    } finally {
      workspace.cleanup();
    }
  });

  it('sends stage 2 byte for byte, including the abandoned-hypothesis lines', async () => {
    const record = loadCases().find((c) => c.id === 'ms-4');
    const workspace = await prepareCase(record);
    try {
      // two ranked entries and provers that decline to submit, so the second prover's task
      // carries what the first hypothesis cost
      const ledger = {
        hypotheses: [
          { claim: 'seconds are mis-parsed', input: "ms('1s')", expected: '1000', observed: 'other' },
          { claim: 'the year constant is wrong', input: "ms('1y')", expected: '31557600000', observed: 'half' },
        ],
      };
      const transport = async (url, init) => {
        const body = JSON.parse(init.body);
        if (body.tools.some((t) => t.function.name === 'record-ledger')) {
          return reply(
            body.messages.some((m) => m.role === 'tool')
              ? { content: 'ledger recorded' }
              : {
                  content: null,
                  tool_calls: [
                    {
                      id: 'c1',
                      type: 'function',
                      function: { name: 'record-ledger', arguments: JSON.stringify(ledger) },
                    },
                  ],
                },
          );
        }
        return reply({ content: '```json\n{"defect": false, "note": "hypothesis is wrong"}\n```' });
      };

      const shipped = await bodiesFrom(runStage2, record, workspace, transport);
      const off = await bodiesFrom(runStage3, record, workspace, transport, { base: 'stage-2', memory: 'off' });
      assert.equal(shipped.length, 4, 'the hypothesizer twice, then one prover per ledger entry');
      assert.deepEqual(off, shipped);
    } finally {
      workspace.cleanup();
    }
  });
});

describe('stage 3 carries lessons from one case to the next', { skip: !existsSync(pristineEntry('ms')) }, () => {
  it('writes the scribe lesson to the file and shows it to the case that follows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stage3-on-'));
    const memoryFile = join(dir, 'memory.md');
    const lesson = 'ms parses a year as 365 days, not a calendar year';
    const tasks = [];

    const transport = async (url, init) => {
      const body = JSON.parse(init.body);
      tasks.push(body.messages[1].content);
      const scribe = body.tools.some((t) => t.function.name === 'append-lessons');
      const message =
        scribe && !body.messages.some((m) => m.role === 'tool')
          ? {
              content: null,
              tool_calls: [
                {
                  id: 'm1',
                  type: 'function',
                  function: { name: 'append-lessons', arguments: JSON.stringify({ lessons: [lesson] }) },
                },
              ],
            }
          : { content: '```json\n{"defect": false, "note": "equivalent"}\n```' };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message, finish_reason: 'stop' }] }) };
    };

    const events = [];
    const trajectory = {
      events,
      path: join(dir, 't.jsonl'),
      write: (type, payload) => events.push({ type, ...payload }),
    };

    try {
      for (const id of ['ms-4', 'ms-12']) {
        const record = loadCases().find((c) => c.id === id);
        const workspace = await prepareCase(record);
        try {
          await runStage3({
            record,
            workspace,
            trajectory,
            model: 'mock',
            transport,
            options: { base: 'stage-1', memory: 'on', memoryFile },
          });
        } finally {
          workspace.cleanup();
        }
      }

      const reviews = tasks.filter((task) => task.includes('Review this change.'));
      assert.equal(reviews.length, 2);
      assert.ok(!reviews[0].includes(lesson), 'the first case reads an empty memory');
      assert.ok(reviews[1].includes(lesson), "the second case is shown the first case's lesson");
      assert.match(reviews[1], /Notes you wrote while reviewing earlier changes/);

      assert.deepEqual(
        events.filter((e) => e.type === 'memory-write').map((e) => e.lessons),
        [[lesson], [lesson]],
      );
      assert.deepEqual(
        events.filter((e) => e.type === 'memory-read').map((e) => e.entries),
        [0, 1],
      );
      assert.match(readFileSync(memoryFile, 'utf8'), /## ms-4 \(ms\) — clean/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads nothing and writes nothing with the memory off', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stage3-off-'));
    const memoryFile = join(dir, 'memory.md');
    const record = loadCases().find((c) => c.id === 'ms-4');
    const workspace = await prepareCase(record);
    const events = [];
    const trajectory = {
      events,
      path: join(dir, 't.jsonl'),
      write: (type, payload) => events.push({ type, ...payload }),
    };

    try {
      const transport = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            { message: { content: '```json\n{"defect": false, "note": "equivalent"}\n```' }, finish_reason: 'stop' },
          ],
        }),
      });
      await runStage3({
        record,
        workspace,
        trajectory,
        model: 'mock',
        transport,
        options: { base: 'stage-1', memory: 'off', memoryFile },
      });
      assert.equal(events.filter((e) => e.type === 'memory-write').length, 0);
      assert.equal(events.find((e) => e.type === 'memory-read').enabled, false);
      assert.equal(existsSync(memoryFile), false);
    } finally {
      workspace.cleanup();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
