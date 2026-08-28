#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { readTrajectory } from './trajectory.mjs';
import { STYLESHEET } from './render/stylesheet.mjs';

/**
 * CLI: `node src/render-trajectory.mjs runs/<file>.jsonl -o out.html`
 *
 * Renders a trajectory as a self-contained HTML page — no external requests, no script,
 * the whole design system inline — in the idiom of a countersigned laboratory notebook:
 * printed apparatus, written record and instrument mono are three separate inks, the run
 * is one unbroken spine of steps, and tool output is a sheet tipped into the book with the
 * event key written across the join. Two rules the renderer may not bend:
 *
 *   - a witness or approval line renders only from a recorded `checkpoint` event. With no
 *     such event the rule prints with the space above it empty and is labelled unwitnessed.
 *     Nothing in this file may put a name or an approval into that space on its own.
 *   - what crosses a tipped-in sheet's join is the event key, never initials.
 */
function main(argv) {
  const args = argv.slice(2);
  const input = args.find((a) => !a.startsWith('-'));
  const outFlag = args.findIndex((a) => a === '-o' || a === '--out');
  if (!input) {
    process.stderr.write('usage: node src/render-trajectory.mjs <trajectory.jsonl> -o <out.html>\n');
    process.exit(1);
  }
  const output = outFlag >= 0 ? args[outFlag + 1] : input.replace(/\.jsonl$/, '.html');
  writeFileSync(output, renderTrajectory(readTrajectory(input), basename(input)));
  process.stdout.write(`rendered ${input} -> ${output}\n`);
}

/**
 * @param {object[]} events events from `readTrajectory`
 * @param {string} [sourceName] filename shown in the masthead and colophon
 * @returns {string} a complete HTML document
 */
export function renderTrajectory(events, sourceName = 'trajectory') {
  const record = readRecord(events);
  const { start, end } = record;
  const title = start.caseId ?? sourceName;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trajectory — ${esc(title)}</title>
<style>
${STYLESHEET}
</style>
</head>
<body>
<main class="leaf">

  <p class="marginal">Fol. 1</p>
  <header class="masthead printed">
    <span>Trajectory &middot; ${esc(sourceName)}</span>
    <span>${esc(start.t ? stamp(start.t) : 'undated')}</span>
  </header>

  <h1>${esc(title)}</h1>

  ${standfirst(record)}

  <p class="marginal at-block">Particulars</p>
  <dl class="particulars">
    ${particular('Model', start.model)}
    ${particular('Steps', end.steps != null ? `${end.steps} of ${start.maxSteps ?? '?'} max` : null)}
    ${particular('Tools', start.tools?.length ? start.tools.join(', ') : null)}
    ${particular('Tokens', tokens(end.usage))}
    ${particular('Wall time', end.wallMs != null ? duration(end.wallMs) : null)}
    ${particular('Cost', end.usage?.costUsd != null ? `$${end.usage.costUsd.toFixed(6)}` : 'not reported')}
  </dl>

  <h2><span class="key">&sect; 1</span>Instructions as issued</h2>
  ${instructions(record)}

  <h2><span class="key">&sect; 2</span>The record</h2>
  <div class="chain">
${record.steps.map((step) => renderStep(step, record)).join('\n')}
  </div>

  <h2><span class="key">&sect; 3</span>Result</h2>
  ${result(record)}

  <h2><span class="key">&sect; 4</span>Attestation</h2>
  ${attestation(record)}

  <div class="legend printed">
    <p><i></i>Step executed</p>
    <p><i class="m-retried"></i>Retried</p>
    <p><i class="m-checkpoint"></i>Human checkpoint</p>
    <p><i class="m-failed"></i>Failed, not retried</p>
  </div>

  <p class="marginal at-block">Fol. 1</p>
  <footer class="colophon printed">
    <span>Rendered from ${esc(sourceName)}</span>
    <span>Fol. 1 of 1</span>
    <span class="note">${esc(tally(record))}</span>
  </footer>

</main>
</body>
</html>
`;
}

/**
 * read the flat event list into the shape the page is set from: the run's envelope, the
 * steps of the chain in order, and the checkpoints the attestation may draw on.
 *
 * Events are keyed by their position in the file rather than by their `seq`, so the key
 * written across a tipped-in sheet's join points at one line of one file even when a file
 * holds more than one run and `seq` restarts.
 *
 * @param {object[]} events
 */
function readRecord(events) {
  const keyed = events.map((event, index) => ({ ...event, key: `e${String(index).padStart(2, '0')}` }));
  const starts = keyed.filter((e) => e.type === 'run-start');
  const ends = keyed.filter((e) => e.type === 'run-end');

  /** @type {{step: number|null, t: string|null, origin: string|null, events: object[]}[]} */
  const steps = [];
  let current = null;
  let origin = null;
  for (const event of keyed) {
    if (event.type === 'run-start') {
      origin = event.t ?? null;
      current = null;
      continue;
    }
    if (event.type === 'run-end') {
      current = null;
      continue;
    }
    // a retry or a checkpoint can be written before the step event it belongs to, so a
    // step is opened by whichever of its events comes first
    if (!current || current.step !== event.step) {
      current = { step: event.step ?? null, t: event.t ?? null, origin, events: [] };
      steps.push(current);
    }
    current.events.push(event);
  }

  return {
    events: keyed,
    start: starts[0] ?? {},
    end: ends.at(-1) ?? {},
    runs: starts.length,
    steps,
    checkpoints: keyed.filter((e) => e.type === 'checkpoint'),
    retries: keyed.filter((e) => e.type === 'retry'),
    failures: keyed.filter((e) => e.type === 'tool-result' && !e.ok),
  };
}

/** the standfirst states the shape of the run in the written hand, from counts only */
function standfirst({ start, end, steps, retries, checkpoints, runs }) {
  const across = runs > 1 ? ` across the ${runs} runs this file holds` : '';
  const parts = [`<b>${steps.length} ${steps.length === 1 ? 'step' : 'steps'}</b> recorded${across}`];
  if (retries.length) parts.push(`<b>${count(retries.length, 'retry', 'retries')}</b>`);
  if (checkpoints.length) parts.push(`<b>${count(checkpoints.length, 'human checkpoint')}</b>`);
  const shape = parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
    : parts[0];
  const ending = end.stopReason
    ? ` The run ended <b>${esc(end.stopReason)}</b>${end.wallMs != null ? ` after ${duration(end.wallMs)}` : ''}.`
    : ' No run-end was recorded.';
  const asked = start.instructions ? '' : ' No instructions were recorded with the run.';
  return `<p class="standfirst">${shape}.${ending}${asked}</p>`;
}

/** the instructions, tipped in verbatim, with the run-start's key across the join */
function instructions({ start }) {
  const text = start.instructions ?? '';
  const tools = start.tools?.length
    ? `\n  <p class="call"><span class="key">Tools</span><code>${esc(start.tools.join(', '))}</code></p>`
    : '';
  return `<figure>
    ${machine(text)}
    <figcaption>${join(start.key)}<span class="what">Instructions as issued &middot; verbatim</span><span class="measure">${text.length} chars</span></figcaption>
  </figure>${tools}`;
}

/**
 * one link of the chain: elapsed time in the printed margin, then the step itself with the
 * mark its state strikes on the spine.
 */
function renderStep(step, record) {
  const turn = step.events.find((e) => e.type === 'step');
  const rest = step.events.filter((e) => e !== turn);
  const retried = step.events.some((e) => e.type === 'retry');
  const checkpointed = step.events.some((e) => e.type === 'checkpoint');
  const failed = step.events.some((e) => e.type === 'tool-result' && !e.ok);

  // one mark per step: the least routine state a step reached is the one struck on the
  // spine. A retry that is also checkpointed still shows its struck attempt below the line,
  // so nothing is lost by the mark naming the checkpoint.
  const mark = checkpointed ? 'checkpoint' : failed ? 'failed' : retried ? 'retried' : '';

  const states = [retried && 'retried', failed && 'failed', checkpointed && 'human checkpoint']
    .filter(Boolean)
    .join(' &middot; ');
  const head = [turn ? 'Assistant' : 'Transport', states].filter(Boolean).join(' &middot; ');
  const measure = turn?.usage?.totalTokens ? `${number(turn.usage.totalTokens)} tok` : '';

  // the run's final text is the last step's text over again; it is set once, under § 3,
  // and the step that wrote it says where it went rather than printing it twice
  const isFinalText = turn?.text != null && turn.text === record.end.result && step === record.steps.at(-1);

  const inside = [
    `      <p class="printed step-head"><span>${head}</span><span>${measure}</span></p>`,
    isFinalText ? '      <p class="printed">Final text &middot; set at &sect; 3</p>' : said(turn?.text),
    ...(turn?.toolCalls ?? []).map(call),
    ...rest.map((event) => renderAttachment(event, record)),
  ].filter((fragment) => fragment !== '');

  return `    <p class="marginal"><span>${esc(elapsed(step.origin, step.t))}</span><br><span>Step ${
    step.step ?? '&mdash;'
  }</span></p>
    <div class="step${mark ? ` ${mark}` : ''}">
${inside.join('\n')}
    </div>`;
}

/** what happened to a step after the agent asked for it, in the order it was recorded */
function renderAttachment(event, record) {
  switch (event.type) {
    case 'tool-result':
      return `      <figure>
        ${machine(event.result ?? '')}
        <figcaption>${join(event.key)}<span class="what">${esc(event.name ?? 'tool')} &middot; ${
          event.ok ? `returned ${bytes(event.result)}` : 'error, not retried'
        }</span><span class="measure">${event.ms != null ? duration(event.ms) : ''}</span></figcaption>
      </figure>`;

    // the failed attempt is struck through and left hanging under the line it replaced
    case 'retry':
      return `      <p class="trim"><span class="struck">${esc(event.reason ?? 'transport failure')}${
        event.delayMs != null ? ` &middot; retrying in ${duration(event.delayMs)}` : ''
      }</span> <span class="correction">Retry ${esc(event.attempt ?? '')}</span></p>`;

    case 'checkpoint':
      return signatureBlock(event);

    default:
      return `      <figure>
        ${machine(JSON.stringify(event, null, 2))}
        <figcaption>${join(event.key)}<span class="what">${esc(
          event.type,
        )} &middot; recorded verbatim</span><span class="measure"></span></figcaption>
      </figure>`;
  }
}

/**
 * a signature block, rendered only from a recorded checkpoint event and only from what that
 * event actually carries. The decision and the note are the record; the renderer adds no
 * name, no approval and no countersignature of its own, and the stamp states what was
 * checked and by what, never that a person checked it.
 *
 * @param {object} event a `checkpoint` event
 */
function signatureBlock(event) {
  const decided = event.decision != null && event.decision !== '';
  return `      <p class="said">${esc(event.question ?? event.label ?? 'A human checkpoint was recorded.')}</p>
      <section class="attest">
        <div>
          <div class="sign">${decided ? `<p class="hand">${esc(event.decision)}</p>` : ''}</div>
          <p class="printed">${
            decided
              ? `Decision recorded &middot; ${esc(clock(event.t))} &middot; ${esc(event.key)}`
              : 'No decision recorded &mdash; unwitnessed'
          }</p>
        </div>
        <div>
          <div class="sign stamped"><p class="hand"><span class="stamp">Recorded by the harness &middot; ${esc(
            event.key,
          )}</span></p></div>
          <p class="printed">${event.note ? esc(event.note) : 'No note recorded'}</p>
        </div>
      </section>`;
}

/**
 * the foot of the page. `Recorded by` states the apparatus that kept the record, which is a
 * machine and is set as one. `Witnessed by` is filled only from a checkpoint event carrying
 * a decision; with none, the rule prints over an empty space and says so.
 */
function attestation({ start, checkpoints }) {
  const witness = checkpoints.find((e) => e.decision != null && e.decision !== '');
  return `<section class="attest">
    <div>
      <div class="sign"><p class="hand machine">${esc(start.model ?? 'model not recorded')}</p></div>
      <p class="printed">Recorded by &middot; agent loop, unattended</p>
    </div>
    <div>
      <div class="sign">${witness ? `<p class="hand">${esc(witness.note ?? witness.decision)}</p>` : ''}</div>
      <p class="printed">${
        witness
          ? `Witnessed by &middot; ${esc(clock(witness.t))} &middot; from ${esc(witness.key)}`
          : 'Witnessed by &mdash; no human checkpoint recorded in this run'
      }</p>
    </div>
  </section>`;
}

/** the run's outcome as the agent left it: the one place the final text is set */
function result({ end }) {
  if (end.error) {
    return `<p class="printed">The run ended in error</p>\n${said(end.error) || '  <p class="said">No error text was recorded.</p>'}`;
  }
  return said(end.result) || '  <p class="said">No final text was recorded.</p>';
}

/** the colophon's count: what the page is made of, so nothing can be dropped unnoticed */
function tally({ events, runs }) {
  const range = events.length ? `${events[0].key}–${events.at(-1).key}` : 'none';
  const many = runs > 1 ? `; ${runs} runs in this file` : '';
  return `${events.length} events recorded, ${range}, unbroken${many}`;
}

/** printed label, machine value: one field of the ruled particulars block */
function particular(label, value) {
  return `<div><dt>${esc(label)}</dt><dd>${esc(value ?? 'not recorded')}</dd></div>`;
}

/** the event key written across the join of a tipped-in sheet — never initials */
function join(key) {
  return `<span class="join">${esc(key ?? 'e??')}</span>`;
}

/** a tool call in the machine hand, under its printed key */
function call(toolCall) {
  const args = toolCall.arguments && typeof toolCall.arguments === 'object'
    ? Object.entries(toolCall.arguments)
        .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
        .join(', ')
    : JSON.stringify(toolCall.arguments ?? null);
  return `      <p class="call"><span class="key">Call</span><code>${esc(toolCall.name)}(${esc(args)})</code></p>`;
}

/**
 * what the agent wrote, in the written hand. Blank lines separate paragraphs so the record
 * keeps the lead; every other line break is preserved by the block's `pre-wrap`. The only
 * markup read out of the text is `**bold**`, which the models emit constantly and which
 * would otherwise print as asterisks in a document claiming to be typeset.
 */
function said(text) {
  if (!text) return '';
  return String(text)
    .split(/\n[ \t]*\n/)
    .map((para) => para.replace(/^\n+|\n+$/g, ''))
    .filter((para) => para !== '')
    .map((para) => `      <p class="said">${bold(esc(para))}</p>`)
    .join('\n');
}

function bold(escaped) {
  return escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/**
 * instrument output, hard-wrapped at 48 columns so no soft wrap reads as an extra emitted
 * line at desktop or print width, with each emitted line its own block so a soft wrap on a
 * narrow screen hangs instead.
 */
function machine(text) {
  const lines = String(text ?? '').split('\n').flatMap((line) => wrap(line, 48));
  return `<pre>${lines.map((line) => `<span>${esc(line)}</span>`).join('')}</pre>`;
}

/** @returns {string[]} `line` broken at `width`, on a space where there is one */
function wrap(line, width) {
  const out = [];
  let rest = line;
  while (rest.length > width) {
    const space = rest.lastIndexOf(' ', width);
    const cut = space > 0 ? space : width;
    out.push(rest.slice(0, cut));
    rest = rest.slice(space > 0 ? cut + 1 : cut);
  }
  out.push(rest);
  return out;
}

/** `mm:ss` since the run started, the chain's absolute position in the run */
function elapsed(origin, t) {
  if (!origin || !t) return '--:--';
  const ms = Date.parse(t) - Date.parse(origin);
  if (!Number.isFinite(ms) || ms < 0) return '--:--';
  const total = Math.round(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** `2026-08-28 · 17:15:15 UTC` */
function stamp(iso) {
  return `${iso.slice(0, 10)} · ${clock(iso)}`;
}

/** `17:15:15 UTC` */
function clock(iso) {
  return iso ? `${iso.slice(11, 19)} UTC` : 'time not recorded';
}

function tokens(usage) {
  if (!usage?.totalTokens) return null;
  return `${number(usage.promptTokens)} in · ${number(usage.completionTokens)} out`;
}

function duration(ms) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function bytes(text) {
  const n = Buffer.byteLength(String(text ?? ''), 'utf8');
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} kB`;
}

function number(value) {
  return Number(value ?? 0).toLocaleString('en-US');
}

function count(n, singular, plural = `${singular}s`) {
  return `${n} ${n === 1 ? singular : plural}`;
}

function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
