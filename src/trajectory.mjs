import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * trajectory event schema (one JSON object per line, JSONL).
 *
 * every event shares an envelope:
 *   {
 *     seq: number,        // 0-based ordinal within the run
 *     t: string,          // ISO-8601 timestamp
 *     type: EventType,    // discriminator, see below
 *     ...payload          // type-specific fields, flattened into the envelope
 *   }
 *
 * event types and their payloads:
 *
 * `run-start`   first line of every file.
 *   { caseId: string, model: string, instructions: string, tools: string[], maxSteps: number }
 *
 * `step`        one assistant turn: its visible text and/or the tool calls it asked for.
 *   { step: number, text: string|null, toolCalls: [{ id, name, arguments }], usage: Usage|null,
 *     finishReason: string|null }
 *
 * `tool-result` the outcome of executing a single tool call from the preceding step.
 *   { step: number, callId: string, name: string, arguments: object,
 *     ok: boolean, result: string, ms: number }
 *
 * `retry`       a transient transport failure that was retried.
 *   { step: number, attempt: number, delayMs: number, reason: string, status: number|null }
 *
 * `checkpoint`  a human approval point: the run paused for a decision.
 *   { step: number, label: string, question: string, decision: string|null, note: string|null }
 *
 * `ledger`      the ranked hypotheses a split candidate produced before any gate attempt. An empty
 *   `hypotheses` with `source` other than `none` is the hypothesizer asserting an equivalent
 *   refactor; `source: 'none'` means no ledger arrived at all.
 *   { entries: number, source: 'tool'|'text'|'none',
 *     hypotheses: [{ rank, claim, input, expected, observed }] }
 *
 * `gate-attempt` one double-run gate attempt by a prover candidate: the test it submitted and the
 *   two exit codes it came back with. Written once per attempt, passed or failed, so a case that
 *   failed the gate and then passed it reads as the sequence it was.
 *   { step: number|null, attempt: number, of: number, passed: boolean, path: string,
 *     command: string, testFile: string, mutant: {code, ms, tail}, pristine: {code, ms, tail} }
 *
 * `gate-outcome` how the gate resolved the run, written after `run-end`.
 *   { resolution: 'proved'|'clean'|'withheld', attempts: number, passedOn?: number, reason?: string }
 *
 * `run-end`     last line of every file.
 *   { result: string|null, stopReason: 'final'|'max-steps'|'error', error: string|null,
 *     usage: Usage, steps: number, wallMs: number }
 *
 * Usage is `{ promptTokens, completionTokens, totalTokens, costUsd }`; costUsd is null when
 * the provider does not report it.
 *
 * @typedef {'run-start'|'step'|'tool-result'|'retry'|'checkpoint'|'ledger'|'gate-attempt'|'gate-outcome'|'run-end'} EventType
 */

/** @typedef {{promptTokens:number, completionTokens:number, totalTokens:number, costUsd:number|null}} Usage */

/** @returns {Usage} a zeroed usage accumulator */
export function emptyUsage() {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null };
}

/**
 * add one provider usage block into an accumulator, in place.
 *
 * @param {Usage} total accumulator to mutate
 * @param {object|null|undefined} raw `usage` object as returned by the chat completions API
 * @returns {Usage} the same accumulator
 */
export function addUsage(total, raw) {
  if (!raw) return total;
  total.promptTokens += raw.prompt_tokens ?? 0;
  total.completionTokens += raw.completion_tokens ?? 0;
  total.totalTokens += raw.total_tokens ?? 0;
  const cost = raw.cost ?? raw.total_cost ?? null;
  if (typeof cost === 'number') total.costUsd = (total.costUsd ?? 0) + cost;
  return total;
}

/** normalise a raw provider usage block into the schema's Usage shape */
export function toUsage(raw) {
  return addUsage(emptyUsage(), raw);
}

/**
 * open a trajectory writer. Appends one JSON line per event; the file is created on first write.
 *
 * @param {object} options
 * @param {string} options.caseId identifier for the task being run, used in the filename
 * @param {string} [options.dir] directory to write into, default `runs/`
 * @param {string} [options.file] explicit path, overrides dir/caseId naming
 * @param {() => Date} [options.now] clock, injectable for tests
 * @returns {{path: string, write: (type: string, payload?: object) => object, events: object[]}}
 */
export function openTrajectory({ caseId, dir = 'runs', file, now = () => new Date() } = {}) {
  const path = file ?? join(dir, `${caseId}-${stamp(now())}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  let seq = 0;
  const events = [];
  return {
    path,
    events,
    write(type, payload = {}) {
      const event = { seq: seq++, t: now().toISOString(), type, ...payload };
      events.push(event);
      appendFileSync(path, `${JSON.stringify(event)}\n`);
      return event;
    },
  };
}

/**
 * read a trajectory file back into events.
 *
 * @param {string} path path to a `.jsonl` trajectory
 * @returns {object[]} parsed events in file order
 */
export function readTrajectory(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`${path}: line ${i + 1} is not valid JSON: ${err.message}`);
      }
    });
}

/** filesystem-safe timestamp, e.g. `2026-08-28T19-09-33` */
function stamp(date) {
  return date.toISOString().replace(/\..+$/, '').replace(/:/g, '-');
}
