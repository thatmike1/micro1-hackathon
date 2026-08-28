#!/usr/bin/env node
/**
 * Offline demo: runs the agent loop against a scripted mock transport, so the whole
 * pipeline (loop -> trajectory -> HTML) is exercised without network or API key.
 *
 * The script includes one transient 503 (to show the retry path) and one tool that
 * requires human approval (to show a checkpoint).
 */
import { runAgent } from '../src/agent-loop.mjs';
import { openTrajectory } from '../src/trajectory.mjs';
import { renderTrajectory } from '../src/render-trajectory.mjs';
import { writeFileSync } from 'node:fs';

const tools = [
  {
    name: 'search-orders',
    description: 'find orders for a customer email',
    parameters: {
      type: 'object',
      properties: { email: { type: 'string' } },
      required: ['email'],
    },
    execute: ({ email }) => [{ id: 'A-1042', email, status: 'stuck-in-transit', total: 89.5 }],
  },
  {
    name: 'issue-refund',
    description: 'refund an order; requires human approval',
    parameters: {
      type: 'object',
      properties: { orderId: { type: 'string' }, amount: { type: 'number' } },
      required: ['orderId', 'amount'],
    },
    requiresApproval: true,
    execute: ({ orderId, amount }) => ({ refunded: true, orderId, amount }),
  },
];

/** scripted responses, consumed in order; a `status` entry is returned as a failed HTTP response */
const script = [
  assistant({
    content: 'Looking up the order first.',
    toolCalls: [{ id: 'c1', name: 'search-orders', args: { email: 'ada@example.com' } }],
    usage: { prompt_tokens: 380, completion_tokens: 28, total_tokens: 408 },
  }),
  { status: 503, body: 'upstream temporarily unavailable' },
  assistant({
    content: 'The order is stuck in transit. Refunding it.',
    toolCalls: [{ id: 'c2', name: 'issue-refund', args: { orderId: 'A-1042', amount: 89.5 } }],
    usage: { prompt_tokens: 520, completion_tokens: 34, total_tokens: 554 },
  }),
  assistant({
    content:
      'Order A-1042 was stuck in transit, so I refunded it in full ($89.50) after approval. ' +
      'Ada should see the refund within 3-5 business days.',
    usage: { prompt_tokens: 660, completion_tokens: 46, total_tokens: 706 },
  }),
];

let call = 0;
const transport = async () => {
  const next = script[Math.min(call++, script.length - 1)];
  if (next.status) {
    return { ok: false, status: next.status, text: async () => next.body };
  }
  return { ok: true, status: 200, json: async () => next };
};

const trajectory = openTrajectory({ file: 'runs/demo.jsonl' });
const result = await runAgent({
  caseId: 'demo-refund-triage',
  model: 'mock/scripted-model',
  instructions:
    'You are a support agent. Look up the customer order, decide whether it warrants a refund, ' +
    'and explain the outcome in plain language. Refunds need human approval.',
  tools,
  task: 'ada@example.com says her order never arrived. Sort it out.',
  trajectory,
  maxSteps: 6,
  transport,
  sleep: () => Promise.resolve(), // no real backoff wait in the demo
  onCheckpoint: () => ({ decision: 'approve', note: 'auto-approved by demo operator' }),
});

writeFileSync('demo.html', renderTrajectory(trajectory.events, 'demo.jsonl'));
process.stdout.write(
  `demo: ${result.stopReason} in ${result.steps} steps, ${result.usage.totalTokens} tokens\n` +
    `wrote runs/demo.jsonl and demo.html\n`,
);

/** build one scripted chat-completions response body */
function assistant({ content = null, toolCalls = [], usage }) {
  return {
    choices: [
      {
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
        message: {
          role: 'assistant',
          content,
          ...(toolCalls.length > 0
            ? {
                tool_calls: toolCalls.map((c) => ({
                  id: c.id,
                  type: 'function',
                  function: { name: c.name, arguments: JSON.stringify(c.args) },
                })),
              }
            : {}),
        },
      },
    ],
    usage,
  };
}
