#!/usr/bin/env node
import { readFileSync } from 'node:fs';

/**
 * CLI: `npm run eval:report -- runs/stage0-baseline-1-<stamp>/summary.json`
 *
 * Plain-text table of one run's metrics. The HTML scoreboard that compares runs is a later phase;
 * this is the reading surface until then.
 */

const COLUMNS = [
  ['case', (c) => c.id, 22],
  ['kind', (c) => c.kind, 8],
  ['outcome', (c) => c.outcome, 14],
  ['claim', (c) => (c.defect == null ? '-' : c.defect ? 'defect' : 'clean'), 7],
  ['proof', (c) => proofCell(c), 14],
  ['wall', (c) => `${(c.wallMs / 1000).toFixed(1)}s`, 7],
  ['tokens', (c) => String(c.usage.totalTokens ?? 0), 8],
  ['cost', (c) => money(c.usage.costUsd), 10],
];

/**
 * @param {object} summary the object written to `summary.json`
 * @returns {string}
 */
export function formatReport(summary) {
  const t = summary.totals;
  const rows = [COLUMNS.map(([name]) => name)];
  for (const c of summary.cases) rows.push(COLUMNS.map(([, cell]) => cell(c)));
  const widths = COLUMNS.map(([, , min], i) =>
    Math.max(min, ...rows.map((row) => row[i].length)),
  );
  const line = (row) => row.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd();

  return [
    `${summary.candidate} — ${summary.description}`,
    `model ${summary.model}, ${summary.cases.length} cases, ${(summary.wallMs / 1000 / 60).toFixed(1)} min wall`,
    '',
    line(rows[0]),
    widths.map((w) => '-'.repeat(w)).join('  '),
    ...rows.slice(1).map(line),
    '',
    `proof rate     ${t.proved}/${t.buggy}${t.proofRate == null ? '' : ` (${(t.proofRate * 100).toFixed(0)}%)`}`,
    `false alarms   ${t.falseAlarms}/${t.controls}`,
    `misses         ${t.misses}   claims not proved ${t.claimUnproved}   no verdict ${t.noVerdict}   errors ${t.errors}`,
    `tokens         ${t.usage.totalTokens} (${t.usage.promptTokens} in / ${t.usage.completionTokens} out)`,
    `cost           ${money(t.usage.costUsd)}`,
  ].join('\n');
}

/** how the double run came out, in one cell: mutant then pristine exit codes */
function proofCell(c) {
  if (!c.proof) return c.error ? 'no proof run' : '-';
  return `${c.proof.proved ? 'red/green' : 'not proved'} ${c.proof.mutant.code}/${c.proof.pristine.code}`;
}

function money(value) {
  return value == null ? 'n/a' : `$${value.toFixed(6)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write('usage: node eval/report.mjs <summary.json>\n');
    process.exit(1);
  }
  process.stdout.write(`${formatReport(JSON.parse(readFileSync(path, 'utf8')))}\n`);
}
