#!/usr/bin/env node
/**
 * Real smoke run: one live OpenRouter call chain with two real tools.
 *
 * Reads OPENROUTER_API_KEY from the environment or from `.env` (gitignored). The key is
 * never printed. Writes `runs/smoke-<timestamp>.jsonl` and the matching HTML render.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { runAgent } from '../src/agent-loop.mjs';
import { openTrajectory } from '../src/trajectory.mjs';
import { renderTrajectory } from '../src/render-trajectory.mjs';

const MODEL = process.env.SMOKE_MODEL ?? 'z-ai/glm-5.3-flash';

const apiKey = process.env.OPENROUTER_API_KEY ?? readDotEnv().OPENROUTER_API_KEY;
if (!apiKey) {
  process.stderr.write('OPENROUTER_API_KEY is not set (env or .env)\n');
  process.exit(1);
}

/** a tiny order book the agent has to actually query; deterministic so the run is checkable */
const ORDERS = {
  'A-1042': { id: 'A-1042', placedDaysAgo: 41, total: 89.5, status: 'delivered' },
  'A-1099': { id: 'A-1099', placedDaysAgo: 6, total: 24.0, status: 'delivered' },
};

const tools = [
  {
    name: 'lookup_order',
    description: 'look up an order by its id',
    parameters: {
      type: 'object',
      properties: { orderId: { type: 'string', description: 'e.g. A-1042' } },
      required: ['orderId'],
    },
    execute: ({ orderId }) => ORDERS[orderId] ?? { error: `no order ${orderId}` },
  },
  {
    name: 'check_return_window',
    description: 'decide whether an order placed N days ago is still returnable',
    parameters: {
      type: 'object',
      properties: { placedDaysAgo: { type: 'number' } },
      required: ['placedDaysAgo'],
    },
    execute: ({ placedDaysAgo }) => ({
      windowDays: 30,
      returnable: placedDaysAgo <= 30,
      daysOverdue: Math.max(0, placedDaysAgo - 30),
    }),
  },
];

const trajectory = openTrajectory({ caseId: 'smoke' });
const result = await runAgent({
  caseId: 'smoke-return-window',
  model: MODEL,
  instructions:
    'You are a support agent. Use the tools to establish the facts before answering; do not guess ' +
    'dates, totals or policy. Finish with a short reply the customer could be sent as-is.',
  tools,
  task: 'A customer wants to return orders A-1042 and A-1099. Which of them can they return, and why?',
  trajectory,
  maxSteps: 8,
  apiKey,
  extraBody: { usage: { include: true } },
});

const htmlPath = trajectory.path.replace(/\.jsonl$/, '.html');
writeFileSync(htmlPath, renderTrajectory(trajectory.events, trajectory.path));

process.stdout.write(
  [
    `model:  ${MODEL}`,
    `stop:   ${result.stopReason}${result.error ? ` (${result.error})` : ''}`,
    `steps:  ${result.steps}`,
    `tokens: ${result.usage.totalTokens} (${result.usage.promptTokens} in / ${result.usage.completionTokens} out)`,
    `cost:   ${result.usage.costUsd == null ? 'not reported' : `$${result.usage.costUsd.toFixed(6)}`}`,
    `wall:   ${(result.wallMs / 1000).toFixed(1)}s`,
    `files:  ${trajectory.path}, ${htmlPath}`,
    '',
    result.text ?? '',
    '',
  ].join('\n'),
);

/** minimal .env reader: `KEY=value` lines, `#` comments, optional surrounding quotes */
function readDotEnv(path = '.env') {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const at = line.indexOf('=');
          return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, '')];
        }),
    );
  } catch {
    return {};
  }
}
