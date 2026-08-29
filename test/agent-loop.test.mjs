import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../src/agent-loop.mjs';

/** in-memory trajectory writer with the same surface as `openTrajectory` */
function recorder() {
  const events = [];
  let seq = 0;
  return {
    events,
    write(type, payload = {}) {
      const event = { seq: seq++, t: new Date().toISOString(), type, ...payload };
      events.push(event);
      return event;
    },
    ofType: (type) => events.filter((e) => e.type === type),
  };
}

function assistantBody({ content = null, toolCalls = [], usage } = {}) {
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
                  function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
                })),
              }
            : {}),
        },
      },
    ],
    usage,
  };
}

/** transport that replays `script` entries in order; `{status, body}` entries fail */
function scripted(script, log = []) {
  let i = 0;
  return async (url, init) => {
    log.push(JSON.parse(init.body));
    const next = script[Math.min(i++, script.length - 1)];
    if (next.status) return { ok: false, status: next.status, text: async () => next.body ?? '' };
    return { ok: true, status: 200, json: async () => next };
  };
}

const base = {
  model: 'test/model',
  instructions: 'be useful',
  task: 'do the thing',
  sleep: () => Promise.resolve(),
};

test('dispatches a tool call and feeds the result back to the model', async () => {
  const calls = [];
  const tools = [
    {
      name: 'add',
      description: 'add two numbers',
      parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
      execute: (args) => {
        calls.push(args);
        return { sum: args.a + args.b };
      },
    },
  ];
  const sent = [];
  const trajectory = recorder();
  const result = await runAgent({
    ...base,
    tools,
    trajectory,
    transport: scripted(
      [
        assistantBody({ toolCalls: [{ id: 't1', name: 'add', args: { a: 2, b: 3 } }] }),
        assistantBody({ content: 'the sum is 5', usage: { total_tokens: 12 } }),
      ],
      sent,
    ),
  });

  assert.deepEqual(calls, [{ a: 2, b: 3 }]);
  assert.equal(result.stopReason, 'final');
  assert.equal(result.text, 'the sum is 5');
  assert.equal(result.steps, 2);

  const toolResult = trajectory.ofType('tool-result')[0];
  assert.equal(toolResult.name, 'add');
  assert.equal(toolResult.ok, true);
  assert.equal(toolResult.result, '{"sum":5}');

  // the tool output must reach the model on the follow-up request
  const followUp = sent[1].messages.at(-1);
  assert.equal(followUp.role, 'tool');
  assert.equal(followUp.tool_call_id, 't1');
  assert.equal(followUp.content, '{"sum":5}');
});

test('an unknown tool is reported back to the model instead of throwing', async () => {
  const trajectory = recorder();
  const result = await runAgent({
    ...base,
    tools: [],
    trajectory,
    transport: scripted([
      assistantBody({ toolCalls: [{ id: 't1', name: 'nope', args: {} }] }),
      assistantBody({ content: 'ok, no such tool' }),
    ]),
  });
  assert.equal(result.stopReason, 'final');
  assert.match(trajectory.ofType('tool-result')[0].result, /no such tool/);
  assert.equal(trajectory.ofType('tool-result')[0].ok, false);
});

test('a throwing tool becomes a failed tool-result, not a run error', async () => {
  const trajectory = recorder();
  const tools = [
    {
      name: 'boom',
      description: 'always fails',
      parameters: { type: 'object', properties: {} },
      execute: () => {
        throw new Error('kaboom');
      },
    },
  ];
  const result = await runAgent({
    ...base,
    tools,
    trajectory,
    transport: scripted([
      assistantBody({ toolCalls: [{ id: 't1', name: 'boom' }] }),
      assistantBody({ content: 'recovered' }),
    ]),
  });
  assert.equal(result.stopReason, 'final');
  assert.equal(trajectory.ofType('tool-result')[0].ok, false);
  assert.match(trajectory.ofType('tool-result')[0].result, /kaboom/);
});

test('retries transient failures with doubling backoff and logs each retry', async () => {
  const delays = [];
  const trajectory = recorder();
  const result = await runAgent({
    ...base,
    tools: [],
    trajectory,
    retryBaseMs: 100,
    sleep: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
    transport: scripted([
      { status: 429, body: 'rate limited' },
      { status: 503, body: 'unavailable' },
      assistantBody({ content: 'finally' }),
    ]),
  });

  assert.equal(result.text, 'finally');
  assert.deepEqual(delays, [100, 200]);
  const retries = trajectory.ofType('retry');
  assert.equal(retries.length, 2);
  assert.deepEqual(
    retries.map((r) => [r.attempt, r.status, r.delayMs]),
    [
      [1, 429, 100],
      [2, 503, 200],
    ],
  );
});

test('gives up after maxRetries and ends the run with an error', async () => {
  const trajectory = recorder();
  const result = await runAgent({
    ...base,
    tools: [],
    trajectory,
    maxRetries: 2,
    transport: scripted([{ status: 500, body: 'boom' }]),
  });
  assert.equal(result.stopReason, 'error');
  assert.match(result.error, /gave up after 3 attempts/);
  assert.equal(trajectory.ofType('retry').length, 2);
});

test('does not retry a non-retryable status', async () => {
  const trajectory = recorder();
  const result = await runAgent({
    ...base,
    tools: [],
    trajectory,
    transport: scripted([{ status: 401, body: 'bad key' }]),
  });
  assert.equal(result.stopReason, 'error');
  assert.match(result.error, /HTTP 401/);
  assert.equal(trajectory.ofType('retry').length, 0);
});

test('stops at maxSteps when the model keeps calling tools', async () => {
  const trajectory = recorder();
  const tools = [
    {
      name: 'loop',
      description: 'never resolves anything',
      parameters: { type: 'object', properties: {} },
      execute: () => 'again',
    },
  ];
  const result = await runAgent({
    ...base,
    tools,
    trajectory,
    maxSteps: 3,
    transport: scripted([assistantBody({ toolCalls: [{ id: 't', name: 'loop' }] })]),
  });

  assert.equal(result.stopReason, 'max-steps');
  assert.equal(result.text, null);
  assert.equal(result.steps, 3);
  assert.equal(trajectory.ofType('step').length, 3);
});

test('raises a checkpoint before an approval-gated tool and honours a denial', async () => {
  const executed = [];
  const trajectory = recorder();
  const tools = [
    {
      name: 'refund',
      description: 'refund an order',
      parameters: { type: 'object', properties: { id: { type: 'string' } } },
      requiresApproval: true,
      execute: (args) => {
        executed.push(args);
        return 'refunded';
      },
    },
  ];
  const result = await runAgent({
    ...base,
    tools,
    trajectory,
    onCheckpoint: () => ({ decision: 'deny', note: 'over the limit' }),
    transport: scripted([
      assistantBody({ toolCalls: [{ id: 't1', name: 'refund', args: { id: 'A-1' } }] }),
      assistantBody({ content: 'escalating to a human' }),
    ]),
  });

  assert.deepEqual(executed, []);
  assert.equal(result.text, 'escalating to a human');
  const checkpoint = trajectory.ofType('checkpoint')[0];
  assert.equal(checkpoint.decision, 'deny');
  assert.equal(checkpoint.note, 'over the limit');
  assert.equal(trajectory.ofType('tool-result')[0].ok, false);
  assert.match(trajectory.ofType('tool-result')[0].result, /denied by human checkpoint/);
});

test('aggregates usage across steps', async () => {
  const trajectory = recorder();
  const tools = [
    {
      name: 'echo',
      description: 'echo',
      parameters: { type: 'object', properties: {} },
      execute: () => 'x',
    },
  ];
  const result = await runAgent({
    ...base,
    tools,
    trajectory,
    transport: scripted([
      assistantBody({
        toolCalls: [{ id: 't1', name: 'echo' }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, cost: 0.0001 },
      }),
      assistantBody({
        content: 'done',
        usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26, cost: 0.0002 },
      }),
    ]),
  });

  assert.equal(result.usage.promptTokens, 30);
  assert.equal(result.usage.completionTokens, 10);
  assert.equal(result.usage.totalTokens, 40);
  assert.ok(Math.abs(result.usage.costUsd - 0.0003) < 1e-9);
});

test('sends the tool registry as JSON-schema function definitions', async () => {
  const sent = [];
  const tools = [
    {
      name: 'add',
      description: 'add two numbers',
      parameters: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] },
      execute: () => 1,
    },
  ];
  await runAgent({
    ...base,
    tools,
    trajectory: recorder(),
    transport: scripted([assistantBody({ content: 'hi' })], sent),
  });
  assert.deepEqual(sent[0].tools, [
    {
      type: 'function',
      function: {
        name: 'add',
        description: 'add two numbers',
        parameters: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] },
      },
    },
  ]);
  assert.equal(sent[0].tool_choice, 'auto');
  assert.deepEqual(sent[0].messages, [
    { role: 'system', content: 'be useful' },
    { role: 'user', content: 'do the thing' },
  ]);
});

test('a tool call cut off by the completion cap is reported, not executed or echoed back raw', async () => {
  const calls = [];
  const tools = [
    {
      name: 'submit',
      description: 'submit something long',
      parameters: { type: 'object', properties: { content: { type: 'string' } } },
      execute: (args) => {
        calls.push(args);
        return 'accepted';
      },
    },
  ];
  const truncated = {
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'c1', type: 'function', function: { name: 'submit', arguments: '{"content": "abc' } },
          ],
        },
      },
    ],
  };
  const sent = [];
  const trajectory = recorder();
  const result = await runAgent({
    ...base,
    tools,
    trajectory,
    maxSteps: 2,
    transport: scripted([truncated, assistantBody({ content: 'shorter next time' })], sent),
  });

  assert.deepEqual(calls, [], 'the tool never sees half an argument object');
  const [toolResult] = trajectory.ofType('tool-result');
  assert.equal(toolResult.ok, false);
  assert.match(toolResult.result, /cut off/);

  // the follow-up request must carry parseable arguments, or the provider rejects the history
  const echoed = sent[1].messages.find((m) => m.role === 'assistant').tool_calls[0];
  assert.doesNotThrow(() => JSON.parse(echoed.function.arguments));
  assert.equal(result.text, 'shorter next time');
});
