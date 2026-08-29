#!/usr/bin/env node
/**
 * Does a model actually emit well-formed tool calls, on each provider that declares it?
 *
 *   node scripts/tool-call-probe.mjs [--model <id>] [--reasoning <off|effort>] [--providers <name>...]
 *
 * The catalog only says a provider *declares* the `tools` parameter. This drives the real agent
 * loop — the same one the prover stages use — once per provider, pinned with
 * `provider: { order: [name], allow_fallbacks: false, require_parameters: true }`, and reports
 * whether the model called the tools, whether the arguments parsed, and whether the final answer
 * carries the facts only the tools could supply.
 *
 * Writes one trajectory per provider under `runs/toolprobe-<model-slug>/`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent } from '../src/agent-loop.mjs';
import { openTrajectory } from '../src/trajectory.mjs';

const DEFAULT_MODEL = 'qwen/qwen3-30b-a3b-instruct-2507';
/** column widths for the report table */
const COLS = [14, 14, 7, 9, 11, 8, 7, 9, 11, 7];

/** a tiny order book the agent has to query; deterministic, so the answer is checkable */
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

const args = parseArgs(process.argv.slice(2));
const apiKey = process.env.OPENROUTER_API_KEY ?? readDotEnv().OPENROUTER_API_KEY;
if (!apiKey) {
  process.stderr.write('OPENROUTER_API_KEY is not set (env or .env)\n');
  process.exit(1);
}

const providers = args.providers.length > 0 ? args.providers : await declaredProviders(args.model);
if (providers.length === 0) throw new Error(`no provider declares tools for ${args.model}`);

const outDir = join('runs', `toolprobe-${args.model.split('/').pop()}`);
const rows = [];

for (const provider of providers) {
  rows.push(await probe(provider));
}

process.stdout.write(
  [
    '',
    `model: ${args.model}   reasoning: ${args.reasoning ?? '(unset)'}`,
    '',
    ['provider', 'served by', 'calls', 'args ok', 'stop', 'answer', 'steps', 'tokens', 'cost', 'wall']
      .map((h, i) => h.padEnd(COLS[i]))
      .join(''),
    ...rows.map((row) =>
      [
        row.provider,
        row.servedBy,
        String(row.toolCalls),
        row.argsOk,
        row.stopReason,
        row.answerOk,
        String(row.steps),
        String(row.tokens),
        row.cost == null ? 'n/a' : `$${row.cost.toFixed(6)}`,
        `${(row.wallMs / 1000).toFixed(1)}s`,
      ]
        .map((cell, i) => cell.padEnd(COLS[i]))
        .join(''),
    ),
    '',
    `trajectories: ${outDir}/`,
    '',
  ].join('\n'),
);

/**
 * One provider, one full loop. The scenario needs two tool calls chained (look the order up, then
 * ask the policy tool about its age), so a model that fakes one call cannot answer correctly.
 * @param {string} provider
 */
async function probe(provider) {
  const trajectory = openTrajectory({ file: join(outDir, `${provider.toLowerCase()}.jsonl`) });
  const result = await runAgent({
    caseId: `toolprobe-${provider}`,
    model: args.model,
    instructions:
      'You are a support agent. Use the tools to establish the facts before answering; do not ' +
      'guess dates, totals or policy. Finish with a short reply the customer could be sent as-is.',
    tools,
    task: 'A customer wants to return orders A-1042 and A-1099. Which of them can they return, and why?',
    trajectory,
    maxSteps: 8,
    apiKey,
    extraBody: {
      usage: { include: true },
      provider: { order: [provider], allow_fallbacks: false, require_parameters: true },
      ...(args.reasoning
        ? { reasoning: args.reasoning === 'off' ? { enabled: false } : { effort: args.reasoning } }
        : {}),
    },
  });

  const steps = trajectory.events.filter((event) => event.type === 'step');
  const calls = steps.flatMap((event) => event.toolCalls ?? []);
  const text = result.text ?? '';
  // the tools are the only source of both facts: 6 days is inside the 30-day window, 41 is not
  const answerOk = /A-1099/.test(text) && /A-1042/.test(text) && /\b(6|41|30)\b/.test(text);

  const row = {
    provider,
    servedBy: [...new Set(steps.map((event) => event.provider).filter(Boolean))].join(',') || '?',
    toolCalls: calls.length,
    argsOk: calls.length === 0 ? '-' : calls.every((call) => call.arguments != null) ? 'yes' : 'NO',
    stopReason: result.stopReason,
    answerOk: result.stopReason === 'error' ? '-' : answerOk ? 'yes' : 'NO',
    steps: result.steps,
    tokens: result.usage.totalTokens,
    cost: result.usage.costUsd,
    wallMs: result.wallMs,
    error: result.error,
    text,
  };
  process.stdout.write(
    `${provider.padEnd(14)} calls ${String(row.toolCalls).padEnd(3)} ${row.stopReason}` +
      `${row.error ? ` (${row.error})` : ''}\n`,
  );
  return row;
}

/** provider names whose endpoint for this model declares the `tools` parameter */
async function declaredProviders(model) {
  const response = await fetch(`https://openrouter.ai/api/v1/models/${model}/endpoints`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`endpoints lookup failed: HTTP ${response.status}`);
  const body = await response.json();
  return (body.data?.endpoints ?? [])
    .filter((endpoint) => (endpoint.supported_parameters ?? []).includes('tools'))
    .map((endpoint) => endpoint.provider_name);
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const parsed = { model: DEFAULT_MODEL, reasoning: null, providers: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--model') parsed.model = argv[++i];
    else if (flag === '--reasoning') parsed.reasoning = argv[++i];
    else if (flag === '--providers') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) parsed.providers.push(argv[++i]);
    } else throw new Error(`unknown argument: ${flag}`);
  }
  return parsed;
}

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
