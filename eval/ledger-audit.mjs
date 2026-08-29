#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readTrajectory } from '../src/trajectory.mjs';

/**
 * CLI: `node eval/ledger-audit.mjs <prefix> [runsDir]`
 *
 * `gate-audit.mjs` reads the gate; this reads the ledger above it, which is the half of stage 2
 * the gate cannot show. Per repetition it prints how many hypotheses were ranked and which rank
 * the proof came from, then the two numbers the split was built to move: how often an empty
 * ledger ended a control without touching the gate, and how many gate attempts the controls cost.
 */
const PREFIX = process.argv[2] ?? 'stage2-';
const RUNS_DIR = process.argv[3] ?? 'runs';

const runs = readdirSync(RUNS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith(PREFIX))
  .filter((e) => existsSync(join(RUNS_DIR, e.name, 'summary.json')))
  .map((e) => ({
    dir: e.name,
    arm: e.name.replace(new RegExp(`^${PREFIX}`), '').replace(/-rep\d+$/, ''),
    rep: Number(/-rep(\d+)$/.exec(e.name)?.[1] ?? 0),
  }))
  .sort((a, b) => a.dir.localeCompare(b.dir));

if (runs.length === 0) throw new Error(`no runs under ${RUNS_DIR}/ matching ${PREFIX}*`);

const arms = new Map();
for (const run of runs) {
  if (!arms.has(run.arm)) arms.set(run.arm, []);
  arms.get(run.arm).push(run);
}

const lines = [];
for (const [arm, reps] of arms) {
  /** @type {Map<string, string[]>} */
  const cases = new Map();
  let entries = 0;
  let empty = 0;
  let missing = 0;
  let provedRank = [0, 0, 0, 0];
  let controlAttempts = 0;
  let controlEmpty = 0;
  let controlRuns = 0;

  for (const run of reps) {
    const dir = join(RUNS_DIR, run.dir);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
      const id = file.replace(/\.jsonl$/, '');
      const events = readTrajectory(join(dir, file));
      const ledger = events.findLast((e) => e.type === 'ledger') ?? null;
      const outcome = events.findLast((e) => e.type === 'gate-outcome') ?? null;
      const attempts = events.filter((e) => e.type === 'gate-attempt');
      const size = ledger?.entries ?? 0;

      entries += size;
      if (ledger && ledger.source !== 'none' && size === 0) empty += 1;
      if (!ledger || ledger.source === 'none') missing += 1;
      if (outcome?.resolution === 'proved' && outcome.hypothesis >= 1) {
        provedRank[Math.min(outcome.hypothesis, provedRank.length) - 1] += 1;
      }
      if (id.includes('control')) {
        controlRuns += 1;
        controlAttempts += attempts.length;
        if (size === 0 && ledger?.source !== 'none') controlEmpty += 1;
      }

      if (!cases.has(id)) cases.set(id, []);
      cases.get(id).push(cell(ledger, attempts, outcome));
    }
  }

  const total = [...cases.values()].reduce((n, c) => n + c.length, 0);
  lines.push(
    '',
    `## ${arm}  (k=${reps.length})`,
    `hypotheses ranked            ${entries} over ${total} runs (${(entries / total).toFixed(2)} per run)`,
    `empty ledgers (clean exit)   ${empty}/${total}`,
    `runs with no ledger at all   ${missing}/${total}`,
    `proofs by ledger rank        ${provedRank.map((n, i) => `#${i + 1}:${n}`).join('  ')}`,
    `control runs                 ${controlRuns}, ${controlAttempts} gate attempts, ${controlEmpty} exited on an empty ledger`,
    '',
    row(['case', ...reps.map((r) => `r${r.rep}`)]),
    ...[...cases].sort((a, b) => a[0].localeCompare(b[0])).map(([id, c]) => row([id, ...c])),
  );
}

process.stdout.write(
  `${lines.join('\n')}\n\ncell: <ledger size>h <gate attempts by hypothesis> <resolution>; ` +
    '"0h" is an empty ledger, "-h" no ledger at all\n',
);

/** one repetition of one case: how big the ledger was, what each hypothesis spent, how it ended */
function cell(ledger, attempts, outcome) {
  const size = !ledger || ledger.source === 'none' ? '-' : String(ledger.entries);
  const byRank = new Map();
  for (const a of attempts) {
    if (!byRank.has(a.hypothesis)) byRank.set(a.hypothesis, []);
    byRank.get(a.hypothesis).push(`${a.mutant.code}/${a.pristine.code}`);
  }
  const spent = [...byRank]
    .sort((a, b) => a[0] - b[0])
    .map(([rank, codes]) => `#${rank}[${codes.join(' ')}]`)
    .join(' ');
  return `${size}h ${spent || '-'} ${outcome?.resolution ?? '?'}`.trim();
}

/** @param {string[]} cells */
function row(cells) {
  return cells.map((c, i) => c.padEnd(i === 0 ? 24 : 34)).join('');
}
