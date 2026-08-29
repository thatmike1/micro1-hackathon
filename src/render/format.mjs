/**
 * The setting rules both emitted pages share: how a value is escaped, how instrument output is
 * broken, how a written passage is set, and how the printed apparatus states a time, a duration
 * or a count.
 *
 * These live here rather than in either page so the trajectory and the review package are the
 * same document in two shapes: one measure, one wrap width, one clock format. A page adds its
 * own structure on top; it does not restate any of this.
 */

/** the wrap width instrument output is broken at across the full measure, in columns */
export const MACHINE_COLUMNS = 48;

/** the same, for a sheet set in one of two columns side by side */
export const HALF_MEASURE_COLUMNS = 28;

export function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

/**
 * what the agent wrote, in the written hand. Blank lines separate paragraphs so the record
 * keeps the lead; every other line break is preserved by the block's `pre-wrap`. The only
 * markup read out of the text is `**bold**`, which the models emit constantly and which
 * would otherwise print as asterisks in a document claiming to be typeset.
 */
export function said(text, indent = '      ') {
  if (!text) return '';
  return String(text)
    .split(/\n[ \t]*\n/)
    .map((para) => para.replace(/^\n+|\n+$/g, ''))
    .filter((para) => para !== '')
    .map((para) => `${indent}<p class="said">${bold(esc(para))}</p>`)
    .join('\n');
}

export function bold(escaped) {
  return escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/**
 * instrument output, hard-wrapped at 48 columns so no soft wrap reads as an extra emitted
 * line at desktop or print width, with each emitted line its own block so a soft wrap on a
 * narrow screen hangs instead.
 */
export function machine(text, columns = MACHINE_COLUMNS) {
  const lines = String(text ?? '')
    .split('\n')
    .flatMap((line) => wrap(line, columns));
  return `<pre>${lines.map((line) => `<span>${esc(line)}</span>`).join('')}</pre>`;
}

/** @returns {string[]} `line` broken at `width`, on a space where there is one */
export function wrap(line, width) {
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

/** the event key written across the join of a tipped-in sheet — never initials */
export function join(key) {
  return `<span class="join">${esc(key ?? 'e??')}</span>`;
}

/** printed label, machine value: one field of the ruled particulars block */
export function particular(label, value) {
  return `<div><dt>${esc(label)}</dt><dd>${esc(value ?? 'not recorded')}</dd></div>`;
}

/** `2026-08-28 · 17:15:15 UTC` */
export function stamp(iso) {
  return `${iso.slice(0, 10)} · ${clock(iso)}`;
}

/** `17:15:15 UTC` */
export function clock(iso) {
  return iso ? `${iso.slice(11, 19)} UTC` : 'time not recorded';
}

export function tokens(usage) {
  if (!usage?.totalTokens) return null;
  return `${number(usage.promptTokens)} in · ${number(usage.completionTokens)} out`;
}

export function duration(ms) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function bytes(text) {
  const n = Buffer.byteLength(String(text ?? ''), 'utf8');
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} kB`;
}

export function number(value) {
  return Number(value ?? 0).toLocaleString('en-US');
}

export function count(n, singular, plural = `${singular}s`) {
  return `${n} ${n === 1 ? singular : plural}`;
}
