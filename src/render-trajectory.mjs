#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { readTrajectory } from './trajectory.mjs';

/**
 * CLI: `node src/render-trajectory.mjs runs/<file>.jsonl -o out.html`
 *
 * Renders a trajectory as a self-contained HTML page: no external requests, inline CSS,
 * every colour/space/font value declared as a custom property in the single `:root` block
 * so a later design pass can restyle by editing that block alone.
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
 * @param {string} [sourceName] filename shown in the header
 * @returns {string} a complete HTML document
 */
export function renderTrajectory(events, sourceName = 'trajectory') {
  const start = events.find((e) => e.type === 'run-start') ?? {};
  const end = events.find((e) => e.type === 'run-end') ?? {};
  const body = events.filter((e) => e.type !== 'run-start' && e.type !== 'run-end');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>trajectory — ${esc(start.caseId ?? sourceName)}</title>
<style>
${CSS}
</style>
</head>
<body>
<main class="page">
  <header class="header">
    <div class="header-title">
      <h1>${esc(start.caseId ?? sourceName)}</h1>
      <p class="source">${esc(sourceName)}</p>
    </div>
    <dl class="facts">
      ${fact('model', start.model)}
      ${fact('started', start.t ? formatTime(start.t) : null)}
      ${fact('wall time', end.wallMs != null ? `${(end.wallMs / 1000).toFixed(1)}s` : null)}
      ${fact('steps', end.steps != null ? `${end.steps} / ${start.maxSteps ?? '?'}` : null)}
      ${fact('tokens', formatTokens(end.usage))}
      ${fact('cost', end.usage?.costUsd != null ? `$${end.usage.costUsd.toFixed(6)}` : null)}
      ${fact('outcome', end.stopReason, end.stopReason === 'error' ? 'bad' : 'good')}
    </dl>
  </header>

  <section class="panel">
    <h2>instructions</h2>
    <pre class="prose">${esc(start.instructions ?? '')}</pre>
    ${start.tools?.length ? `<p class="tools">tools: ${start.tools.map((t) => `<code>${esc(t)}</code>`).join(' ')}</p>` : ''}
  </section>

  <section class="chain">
    ${body.map(renderEvent).join('\n')}
  </section>

  <section class="panel result ${end.stopReason === 'error' ? 'result-error' : ''}">
    <h2>result</h2>
    <pre class="prose">${esc(end.error ?? end.result ?? '(no final text)')}</pre>
  </section>
</main>
</body>
</html>
`;
}

function renderEvent(event) {
  switch (event.type) {
    case 'step':
      return `<article class="event event-step">
  <div class="event-head"><span class="badge">step ${event.step}</span>${
    event.finishReason ? `<span class="meta">${esc(event.finishReason)}</span>` : ''
  }${event.usage ? `<span class="meta">${formatTokens(event.usage)}</span>` : ''}</div>
  ${event.text ? `<pre class="prose">${esc(event.text)}</pre>` : ''}
  ${(event.toolCalls ?? [])
    .map(
      (call) => `<div class="call"><span class="call-name">→ ${esc(call.name)}</span>
    <pre class="code">${esc(JSON.stringify(call.arguments, null, 2))}</pre></div>`,
    )
    .join('\n')}
</article>`;

    case 'tool-result':
      return `<article class="event event-tool ${event.ok ? '' : 'is-bad'}">
  <div class="event-head"><span class="badge badge-tool">${esc(event.name)}</span><span class="meta">${
    event.ok ? 'ok' : 'failed'
  } · ${event.ms}ms</span></div>
  <pre class="code">${esc(event.result ?? '')}</pre>
</article>`;

    case 'retry':
      return `<article class="event event-retry">
  <div class="event-head"><span class="badge badge-retry">retry ${event.attempt}</span><span class="meta">backoff ${event.delayMs}ms</span></div>
  <p class="prose">${esc(event.reason ?? '')}</p>
</article>`;

    case 'checkpoint':
      return `<article class="event event-checkpoint">
  <div class="event-head"><span class="badge badge-checkpoint">checkpoint</span><span class="meta">${esc(
    event.decision ?? 'pending',
  )}</span></div>
  <p class="prose">${esc(event.question ?? event.label ?? '')}</p>
  ${event.note ? `<p class="prose note">${esc(event.note)}</p>` : ''}
</article>`;

    default:
      return `<article class="event"><div class="event-head"><span class="badge">${esc(
        event.type,
      )}</span></div><pre class="code">${esc(JSON.stringify(event, null, 2))}</pre></article>`;
  }
}

function fact(label, value, tone) {
  if (value == null) return '';
  return `<div class="fact${tone ? ` is-${tone}` : ''}"><dt>${esc(label)}</dt><dd>${esc(String(value))}</dd></div>`;
}

function formatTokens(usage) {
  if (!usage || !usage.totalTokens) return null;
  return `${usage.totalTokens} (${usage.promptTokens} in / ${usage.completionTokens} out)`;
}

function formatTime(iso) {
  return iso.replace('T', ' ').replace(/\..*$/, ' UTC');
}

function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

const CSS = `:root {
  --color-bg: #f6f6f4;
  --color-surface: #ffffff;
  --color-surface-alt: #f0f0ed;
  --color-text: #1a1a18;
  --color-text-muted: #6b6b66;
  --color-border: #dcdcd6;
  --color-accent: #2f5fd0;
  --color-tool: #0f7a5a;
  --color-retry: #b06a00;
  --color-checkpoint: #7a3fbf;
  --color-bad: #c0392b;
  --color-good: #0f7a5a;

  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --font-size-base: 15px;
  --font-size-small: 12.5px;
  --font-size-title: 25px;
  --line-height: 1.55;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 18px;
  --space-5: 28px;
  --space-6: 44px;

  --radius: 8px;
  --border-width: 1px;
  --rail-width: 2px;
  --page-width: 860px;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: var(--font-size-base);
  line-height: var(--line-height);
}

.page {
  max-width: var(--page-width);
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
}

h1 { font-size: var(--font-size-title); margin: 0; }
h2 {
  font-size: var(--font-size-small);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
  margin: 0 0 var(--space-3);
}

.header {
  background: var(--color-surface);
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: var(--space-4);
  margin-bottom: var(--space-4);
}
.source { margin: var(--space-1) 0 0; color: var(--color-text-muted); font-family: var(--font-mono); font-size: var(--font-size-small); }

.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-3);
  margin: var(--space-4) 0 0;
}
.fact dt { font-size: var(--font-size-small); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.fact dd { margin: var(--space-1) 0 0; font-family: var(--font-mono); }
.fact.is-good dd { color: var(--color-good); }
.fact.is-bad dd { color: var(--color-bad); }

.panel {
  background: var(--color-surface);
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius);
  padding: var(--space-4);
  margin-bottom: var(--space-4);
}
.tools { margin: var(--space-3) 0 0; color: var(--color-text-muted); font-size: var(--font-size-small); }
.tools code { font-family: var(--font-mono); background: var(--color-surface-alt); padding: 0 var(--space-1); border-radius: var(--radius); }

.chain {
  border-left: var(--rail-width) solid var(--color-border);
  padding-left: var(--space-4);
  margin: 0 0 var(--space-4) var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.event {
  background: var(--color-surface);
  border: var(--border-width) solid var(--color-border);
  border-left: var(--rail-width) solid var(--color-accent);
  border-radius: var(--radius);
  padding: var(--space-3) var(--space-4);
}
.event-tool { border-left-color: var(--color-tool); background: var(--color-surface-alt); }
.event-retry { border-left-color: var(--color-retry); }
.event-checkpoint { border-left-color: var(--color-checkpoint); }
.event.is-bad { border-left-color: var(--color-bad); }

.event-head { display: flex; align-items: baseline; gap: var(--space-3); flex-wrap: wrap; }
.badge {
  font-family: var(--font-mono);
  font-size: var(--font-size-small);
  font-weight: 600;
  color: var(--color-accent);
}
.badge-tool { color: var(--color-tool); }
.badge-retry { color: var(--color-retry); }
.badge-checkpoint { color: var(--color-checkpoint); }
.meta { font-size: var(--font-size-small); color: var(--color-text-muted); font-family: var(--font-mono); }

.prose { margin: var(--space-2) 0 0; white-space: pre-wrap; word-wrap: break-word; font-family: inherit; }
.note { color: var(--color-text-muted); }
.code {
  margin: var(--space-2) 0 0;
  padding: var(--space-2) var(--space-3);
  background: var(--color-surface-alt);
  border-radius: var(--radius);
  font-family: var(--font-mono);
  font-size: var(--font-size-small);
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-x: auto;
}
.event-tool .code { background: var(--color-surface); }

.call { margin-top: var(--space-2); }
.call-name { font-family: var(--font-mono); font-size: var(--font-size-small); color: var(--color-accent); }

.result pre { font-family: inherit; }
.result-error { border-color: var(--color-bad); }
.result-error pre { color: var(--color-bad); }`;

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
