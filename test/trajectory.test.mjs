import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTrajectory, readTrajectory, emptyUsage, addUsage } from '../src/trajectory.mjs';
import { runAgent } from '../src/agent-loop.mjs';
import { renderTrajectory } from '../src/render-trajectory.mjs';

/** required fields per event type, as documented in the trajectory.mjs schema block */
const SCHEMA = {
  'run-start': ['caseId', 'model', 'instructions', 'tools', 'maxSteps'],
  step: ['step', 'text', 'toolCalls', 'finishReason'],
  'tool-result': ['step', 'callId', 'name', 'arguments', 'ok', 'result', 'ms'],
  retry: ['step', 'attempt', 'delayMs', 'reason', 'status'],
  checkpoint: ['step', 'label', 'question', 'decision'],
  'run-end': ['result', 'stopReason', 'error', 'usage', 'steps', 'wallMs'],
};

async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'traj-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('writes one JSON line per event with a sequential envelope', async () => {
  await withTempDir((dir) => {
    const trajectory = openTrajectory({ caseId: 'case-1', dir });
    trajectory.write('run-start', { caseId: 'case-1', model: 'm' });
    trajectory.write('run-end', { result: 'done' });

    const events = readTrajectory(trajectory.path);
    assert.equal(events.length, 2);
    assert.deepEqual(
      events.map((e) => e.seq),
      [0, 1],
    );
    events.forEach((e) => assert.ok(!Number.isNaN(Date.parse(e.t)), 't is an ISO timestamp'));
    assert.equal(events[0].caseId, 'case-1');
    assert.ok(trajectory.path.startsWith(dir));
  });
});

test('addUsage accumulates provider fields and tolerates missing usage', () => {
  const total = emptyUsage();
  addUsage(total, { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
  addUsage(total, undefined);
  addUsage(total, { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0.5 });
  assert.deepEqual(total, {
    promptTokens: 6,
    completionTokens: 3,
    totalTokens: 9,
    costUsd: 0.5,
  });
});

test('a full run writes a schema-valid file that starts and ends with the run markers', async () => {
  await withTempDir(async (dir) => {
    const trajectory = openTrajectory({ caseId: 'schema', dir });
    const tools = [
      {
        name: 'gated',
        description: 'needs approval',
        parameters: { type: 'object', properties: {} },
        requiresApproval: true,
        execute: () => 'ok',
      },
    ];
    const script = [
      { status: 503, body: 'nope' },
      body({ toolCalls: [{ id: 't1', name: 'gated' }] }),
      body({ content: 'all done', usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } }),
    ];
    let i = 0;
    await runAgent({
      caseId: 'schema',
      model: 'test/model',
      instructions: 'be useful',
      task: 'go',
      tools,
      trajectory,
      sleep: () => Promise.resolve(),
      transport: async () => {
        const next = script[Math.min(i++, script.length - 1)];
        return next.status
          ? { ok: false, status: next.status, text: async () => next.body }
          : { ok: true, status: 200, json: async () => next };
      },
    });

    const events = readTrajectory(trajectory.path);
    assert.equal(events[0].type, 'run-start');
    assert.equal(events.at(-1).type, 'run-end');

    const seen = new Set();
    for (const event of events) {
      assert.ok(SCHEMA[event.type], `unknown event type ${event.type}`);
      for (const field of SCHEMA[event.type]) {
        assert.ok(field in event, `${event.type} is missing ${field}`);
      }
      seen.add(event.type);
    }
    // this run exercises every event type the schema documents
    assert.deepEqual([...seen].sort(), Object.keys(SCHEMA).sort());

    // the rendered page is self-contained: no external requests
    const html = renderTrajectory(events, 'schema.jsonl');
    assert.match(html, /^<!doctype html>/);
    assert.doesNotMatch(html, /https?:\/\//);
    assert.doesNotMatch(html, /<script/);
    assert.match(html, /all done/);
  });
});

test('readTrajectory names the offending line for malformed JSON', async () => {
  await withTempDir((dir) => {
    const trajectory = openTrajectory({ caseId: 'bad', dir });
    trajectory.write('run-start', {});
    appendFileSync(trajectory.path, '{not json\n');
    assert.throws(() => readTrajectory(trajectory.path), /line 2 is not valid JSON/);
  });
});

function body({ content = null, toolCalls = [], usage } = {}) {
  return {
    choices: [
      {
        finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
        message: {
          role: 'assistant',
          content,
          ...(toolCalls.length
            ? {
                tool_calls: toolCalls.map((c) => ({
                  id: c.id,
                  type: 'function',
                  function: { name: c.name, arguments: '{}' },
                })),
              }
            : {}),
        },
      },
    ],
    usage,
  };
}
