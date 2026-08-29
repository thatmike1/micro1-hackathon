#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CLI: `node eval/analyze-k3.mjs [prefix] [runsDir]`
 *
 * Reads the `summary.json` of every `runs/<prefix>...-rep<n>` directory and prints the reliability
 * view the day-2 metric is stated in: per repetition proof rate, then the primary number, the
 * cases proved in EVERY repetition, plus the per-case outcome matrix that shows which cases wobble.
 *
 * A single-run proof rate is one draw; this is the number a claim about the gate has to move.
 */
const PREFIX = process.argv[2] ?? 'day2-';
const RUNS_DIR = process.argv[3] ?? 'runs';

/** an outcome rendered as one character, so a wide matrix still fits a page */
const MARK = {
  proved: 'P',
  'claim-unproved': 'u',
  miss: '.',
  correct: 'C',
  'false-alarm': 'A',
  'no-verdict': '?',
  error: 'E',
};

const runs = readdirSync(RUNS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith(PREFIX))
  .filter((entry) => existsSync(join(RUNS_DIR, entry.name, 'summary.json')))
  .map((entry) => {
    const summary = JSON.parse(readFileSync(join(RUNS_DIR, entry.name, 'summary.json'), 'utf8'));
    return {
      dir: entry.name,
      arm: entry.name.replace(new RegExp(`^${PREFIX}`), '').replace(/-rep\d+$/, ''),
      rep: Number(/-rep(\d+)$/.exec(entry.name)?.[1] ?? 0),
      summary,
    };
  })
  .sort((a, b) => a.dir.localeCompare(b.dir));

if (runs.length === 0) throw new Error(`no runs under ${RUNS_DIR}/ matching ${PREFIX}*`);

const arms = new Map();
for (const run of runs) {
  if (!arms.has(run.arm)) arms.set(run.arm, []);
  arms.get(run.arm).push(run);
}

const lines = [];
for (const [arm, reps] of arms) {
  const first = reps[0].summary;
  lines.push(
    '',
    `## ${arm}  (k=${reps.length})`,
    `model ${first.model}   request ${JSON.stringify(first.requestExtras)}`,
    '',
    row(['rep', 'proof rate', 'false alarms', 'claim-unproved', 'miss', 'no-verdict', 'error', 'tokens', 'cost', 'wall']),
  );
  for (const run of reps) {
    const t = run.summary.totals;
    lines.push(
      row([
        String(run.rep),
        `${t.proved}/${t.buggy}`,
        `${t.falseAlarms}/${t.controls}`,
        String(t.claimUnproved),
        String(t.misses),
        String(t.noVerdict),
        String(t.errors),
        String(t.usage.totalTokens),
        t.usage.costUsd == null ? 'n/a' : `$${t.usage.costUsd.toFixed(4)}`,
        `${(run.summary.wallMs / 60000).toFixed(1)} min`,
      ]),
    );
  }

  // the primary metric: a case counts only if every repetition proved it
  const byCase = new Map();
  for (const run of reps) {
    for (const record of run.summary.cases) {
      if (!byCase.has(record.id)) byCase.set(record.id, { kind: record.kind, outcomes: [] });
      byCase.get(record.id).outcomes.push(record.outcome);
    }
  }
  const buggy = [...byCase].filter(([, c]) => c.kind === 'buggy');
  const controls = [...byCase].filter(([, c]) => c.kind === 'control');
  const allProved = buggy.filter(([, c]) => c.outcomes.every((o) => o === 'proved'));
  const anyProved = buggy.filter(([, c]) => c.outcomes.some((o) => o === 'proved'));
  const flips = buggy.filter(([, c]) => new Set(c.outcomes).size > 1);
  const anyAlarm = controls.filter(([, c]) => c.outcomes.some((o) => o === 'false-alarm'));

  lines.push(
    '',
    `proved in ALL ${reps.length} reps   **${allProved.length}/${buggy.length}**`,
    `proved in at least one         ${anyProved.length}/${buggy.length}`,
    `cases that flip between reps   ${flips.length}/${buggy.length}` +
      (flips.length ? `  (${flips.map(([id]) => id).join(', ')})` : ''),
    `controls false-alarmed at least once  ${anyAlarm.length}/${controls.length}`,
    '',
    row(['case', 'kind', ...reps.map((r) => `r${r.rep}`)]),
    ...[...byCase].map(([id, c]) =>
      row([id, c.kind, ...c.outcomes.map((outcome) => MARK[outcome] ?? '?')]),
    ),
  );
}

process.stdout.write(`${lines.join('\n')}\n\nmarks: ${Object.entries(MARK).map(([k, v]) => `${v}=${k}`).join('  ')}\n`);

/** @param {string[]} cells */
function row(cells) {
  const widths = [24, 12, 14, 16, 6, 12, 8, 10, 11, 10];
  return cells.map((cell, i) => cell.padEnd(widths[i] ?? 6)).join('');
}
