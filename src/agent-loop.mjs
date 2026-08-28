import { addUsage, emptyUsage, toUsage } from './trajectory.mjs';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/**
 * @typedef {object} Tool
 * @property {string} name
 * @property {string} description
 * @property {object} parameters JSON Schema for the arguments object
 * @property {(args: object) => Promise<unknown>|unknown} execute
 * @property {boolean} [requiresApproval] when true, the loop raises a checkpoint before executing
 */

/**
 * Run a tool-use loop against an OpenAI-compatible chat completions endpoint.
 *
 * The loop alternates model turns and tool execution until the model answers without
 * requesting tools, `maxSteps` is reached, or a tool-free error stops it. Every model turn,
 * tool result, retry and checkpoint is written to the trajectory.
 *
 * @param {object} options
 * @param {string} options.model model id, e.g. `z-ai/glm-4.6`
 * @param {string} options.instructions system instructions
 * @param {Tool[]} options.tools tool registry; may be empty
 * @param {string} options.task the user task
 * @param {{write: (type: string, payload?: object) => object}} options.trajectory writer from `openTrajectory`
 * @param {string} [options.caseId] identifier recorded in `run-start`
 * @param {number} [options.maxSteps] hard cap on model turns, default 10
 * @param {string} [options.apiKey] OpenRouter key; omitted for mock transports
 * @param {string} [options.baseUrl] API base, default OpenRouter
 * @param {typeof fetch} [options.transport] injectable fetch, for mocks and tests
 * @param {number} [options.maxRetries] transient-failure retries per request, default 3
 * @param {number} [options.retryBaseMs] first backoff delay in ms, doubling per attempt, default 500
 * @param {(ms: number) => Promise<void>} [options.sleep] injectable delay, for tests
 * @param {object} [options.extraBody] extra fields merged into the request body, e.g. OpenRouter's
 *   `{ usage: { include: true } }` which makes the provider report per-call cost
 * @param {(ctx: object) => Promise<{decision: string, note?: string}>|{decision: string, note?: string}} [options.onCheckpoint]
 *   consulted before any tool marked `requiresApproval`; anything other than `approve` skips the call
 * @returns {Promise<{text: string|null, stopReason: 'final'|'max-steps'|'error', error: string|null,
 *   usage: import('./trajectory.mjs').Usage, steps: number, wallMs: number, messages: object[]}>}
 */
export async function runAgent({
  model,
  instructions,
  tools = [],
  task,
  trajectory,
  caseId = 'run',
  maxSteps = 10,
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  transport = globalThis.fetch,
  maxRetries = 3,
  retryBaseMs = 500,
  sleep = defaultSleep,
  extraBody = {},
  onCheckpoint = () => ({ decision: 'approve' }),
}) {
  const startedAt = Date.now();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const usage = emptyUsage();
  const messages = [
    { role: 'system', content: instructions },
    { role: 'user', content: task },
  ];

  trajectory.write('run-start', {
    caseId,
    model,
    instructions,
    tools: tools.map((tool) => tool.name),
    maxSteps,
    requestExtras: extraBody,
  });

  const providers = new Set();
  let reasoningTokens = null;

  let text = null;
  let stopReason = 'max-steps';
  let error = null;
  let step = 0;

  try {
    for (step = 1; step <= maxSteps; step++) {
      const body = {
        model,
        messages,
        ...(tools.length > 0 ? { tools: tools.map(toToolSchema), tool_choice: 'auto' } : {}),
        ...extraBody,
      };
      const response = await requestWithRetry({
        url: `${baseUrl}/chat/completions`,
        body,
        apiKey,
        transport,
        maxRetries,
        retryBaseMs,
        sleep,
        trajectory,
        step,
      });

      const choice = response.choices?.[0];
      if (!choice) throw new Error('response contained no choices');
      const message = choice.message ?? {};
      const toolCalls = (message.tool_calls ?? []).map((call) => ({
        id: call.id,
        name: call.function?.name,
        arguments: parseArguments(call.function?.arguments),
      }));

      addUsage(usage, response.usage);
      if (response.provider) providers.add(response.provider);
      const stepReasoning = response.usage?.completion_tokens_details?.reasoning_tokens;
      if (typeof stepReasoning === 'number') reasoningTokens = (reasoningTokens ?? 0) + stepReasoning;
      trajectory.write('step', {
        step,
        text: message.content ?? null,
        toolCalls,
        usage: response.usage ? toUsage(response.usage) : null,
        finishReason: choice.finish_reason ?? null,
        provider: response.provider ?? null,
        reasoningTokens: typeof stepReasoning === 'number' ? stepReasoning : null,
      });

      messages.push({
        role: 'assistant',
        content: message.content ?? null,
        ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
      });

      if (toolCalls.length === 0) {
        text = message.content ?? null;
        stopReason = 'final';
        break;
      }

      for (const call of toolCalls) {
        const outcome = await executeCall({ call, byName, step, trajectory, onCheckpoint });
        messages.push({ role: 'tool', tool_call_id: call.id, content: outcome.result });
      }
    }
  } catch (err) {
    stopReason = 'error';
    error = err.message;
  }

  const steps = stopReason === 'max-steps' ? maxSteps : Math.min(step, maxSteps);
  const wallMs = Date.now() - startedAt;
  trajectory.write('run-end', {
    result: text,
    stopReason,
    error,
    usage,
    steps,
    wallMs,
    providers: [...providers],
    reasoningTokens,
  });

  return { text, stopReason, error, usage, steps, wallMs, messages, providers: [...providers], reasoningTokens };
}

/** run one tool call, logging a checkpoint first when the tool asks for approval */
async function executeCall({ call, byName, step, trajectory, onCheckpoint }) {
  const tool = byName.get(call.name);
  const startedAt = Date.now();

  if (!tool) {
    return finish(false, `error: no such tool "${call.name}"`);
  }

  if (tool.requiresApproval) {
    const question = `approve calling ${call.name} with ${JSON.stringify(call.arguments)}?`;
    const { decision = 'approve', note = null } = (await onCheckpoint({
      step,
      tool: call.name,
      arguments: call.arguments,
      question,
    })) ?? {};
    trajectory.write('checkpoint', {
      step,
      label: `approval: ${call.name}`,
      question,
      decision,
      note,
    });
    if (decision !== 'approve') {
      return finish(false, `denied by human checkpoint (${decision})${note ? `: ${note}` : ''}`);
    }
  }

  try {
    const result = await tool.execute(call.arguments);
    return finish(true, stringify(result));
  } catch (err) {
    return finish(false, `error: ${err.message}`);
  }

  function finish(ok, result) {
    trajectory.write('tool-result', {
      step,
      callId: call.id,
      name: call.name,
      arguments: call.arguments,
      ok,
      result,
      ms: Date.now() - startedAt,
    });
    return { ok, result };
  }
}

/**
 * POST one chat completion, retrying transient failures with exponential backoff.
 * Each retry is written to the trajectory as a `retry` event.
 */
async function requestWithRetry({
  url,
  body,
  apiKey,
  transport,
  maxRetries,
  retryBaseMs,
  sleep,
  trajectory,
  step,
}) {
  for (let attempt = 0; ; attempt++) {
    let status = null;
    let reason;
    try {
      const response = await transport(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });
      status = response.status ?? null;
      if (response.ok) return await response.json();
      const detail = await safeText(response);
      reason = `HTTP ${status}${detail ? `: ${truncate(detail, 300)}` : ''}`;
      if (!RETRYABLE_STATUS.has(status)) throw new Error(reason);
    } catch (err) {
      // a non-retryable HTTP status is rethrown above and must not be retried here
      if (reason && !RETRYABLE_STATUS.has(status)) throw err;
      reason = reason ?? `transport error: ${err.message}`;
    }

    if (attempt >= maxRetries) throw new Error(`${reason} (gave up after ${attempt + 1} attempts)`);
    const delayMs = retryBaseMs * 2 ** attempt;
    trajectory.write('retry', { step, attempt: attempt + 1, delayMs, reason, status });
    await sleep(delayMs);
  }
}

/** convert a registry entry into the wire format the API expects */
function toToolSchema(tool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

/** tool arguments arrive as a JSON string; malformed JSON is surfaced to the model, not thrown */
function parseArguments(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw, _parseError: true };
  }
}

function stringify(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

async function safeText(response) {
  try {
    return typeof response.text === 'function' ? await response.text() : '';
  } catch {
    return '';
  }
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
