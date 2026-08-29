#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readTrajectory } from '../src/trajectory.mjs';

/**
 * CLI: `node eval/memory-audit.mjs [prefix] [runsDir]`
 *
 * `analyze-k3.mjs` scores the answers and `gate-audit.mjs` reads the gate; this reads the memory
 * the stage-3 arms carry between cases, and the price of carrying it.
 *
 * Two things the score cannot show:
 *
 * - the memory as it actually grew: the run order, how many case blocks each case was shown, and
 *   what the scribe wrote. A lesson that is wrong is still a lesson, and it is in every prompt
 *   after the case that wrote it.
 * - the cost split. The scribe is a model turn that produces no verdict, so an arm's tokens are
 *   review tokens plus memory overhead, and only the first of those is comparable with an arm
 *   that has no memory. The gate attempt count is the other cost the flash arm is judged on,
 *   since its proof rate has no headroom left.
 *
 * Arms whose names differ only by `-on`/`-off` are paired at the end into the ablation table.
 */
const PREFIX = process.argv[2] ?? 'stage3-';
const RUNS_DIR = process.argv[3] ?? 'runs';

const runs = readdirSync(RUNS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith(PREFIX))
  .filter((e) => existsSync(join(RUNS_DIR, e.name, 'summary.json')))
  .map((e) => ({
    dir: e.name,
    arm: e.name.replace(new RegExp(`^${PREFIX}`), '').replace(/-rep\d+$/, ''),
    rep: Number(/-rep(\d+)$/.exec(e.name)?.[1] ?? 0),
    summary: JSON.parse(readFileSync(join(RUNS_DIR, e.name, 'summary.json'), 'utf8')),
  }))
  .sort((a, b) => a.dir.localeCompare(b.dir));

if (runs.length === 0) throw new Error(`no runs under ${RUNS_DIR}/ matching ${PREFIX}*`);

const arms = new Map();
for (const run of runs) {
  if (!arms.has(run.arm)) arms.set(run.arm, []);
  arms.get(run.arm).push(run);
}

const lines = [];
/** @type {Map<string, object>} arm name -> its totals, for the paired table */
const rollups = new Map();

for (const [arm, reps] of arms) {
  const first = reps[0].summary;
  const roll = {
    runs: 0,
    lessons: 0,
    silentScribes: 0,
    gateAttempts: 0,
    reviewTokens: 0,
    scribeTokens: 0,
    totalTokens: 0,
    cost: 0,
    scribeCost: 0,
    wallMs: 0,
  };
  /** @type {Map<string, string[]>} */
  const cells = new Map();

  for (const run of reps) {
    roll.wallMs += run.summary.wallMs;
    const dir = join(RUNS_DIR, run.dir);
    for (const record of run.summary.cases) {
      const events = readTrajectory(join(dir, record.trajectory));
      const read = events.find((e) => e.type === 'memory-read') ?? null;
      const write = events.findLast((e) => e.type === 'memory-write') ?? null;
      const attempts = events.filter((e) => e.type === 'gate-attempt').length;
      const scribeTokens = write?.usage?.totalTokens ?? 0;
      const scribeCost = write?.usage?.costUsd ?? 0;

      roll.runs += 1;
      roll.lessons += write?.lessons?.length ?? 0;
      if (write && (write.lessons?.length ?? 0) === 0) roll.silentScribes += 1;
      roll.gateAttempts += attempts;
      roll.totalTokens += record.usage?.totalTokens ?? 0;
      roll.scribeTokens += scribeTokens;
      roll.reviewTokens += (record.usage?.totalTokens ?? 0) - scribeTokens;
      roll.cost += record.usage?.costUsd ?? 0;
      roll.scribeCost += scribeCost;

      if (!cells.has(record.id)) cells.set(record.id, []);
      cells
        .get(record.id)
        .push(
          `${read?.entries ?? '-'}b/${write?.lessons?.length ?? '-'}l ${attempts}g ${record.outcome}`,
        );
    }
  }
  rollups.set(arm, roll);

  lines.push(
    '',
    `## ${arm}  (k=${reps.length})`,
    `model ${first.model}   options ${JSON.stringify(first.candidateOptions ?? {})}   concurrency ${first.concurrency ?? '?'}`,
    `run order  ${(first.order ?? []).join(' → ')}`,
    '',
    `lessons written             ${roll.lessons} over ${roll.runs} runs (${(roll.lessons / roll.runs).toFixed(2)} per case)`,
    `cases that taught nothing   ${roll.silentScribes}/${roll.runs}`,
    `gate attempts               ${roll.gateAttempts}`,
    `tokens  review              ${roll.reviewTokens}`,
    `        memory overhead     ${roll.scribeTokens}`,
    `        total               ${roll.totalTokens}`,
    `cost                        $${roll.cost.toFixed(4)} (memory overhead $${roll.scribeCost.toFixed(4)})`,
    '',
    row(['case', ...reps.map((r) => `r${r.rep}`)]),
    ...[...cells].sort((a, b) => a[0].localeCompare(b[0])).map(([id, c]) => row([id, ...c])),
  );

  const memoryFiles = reps
    .map((run) => join(RUNS_DIR, run.dir, 'memory.md'))
    .filter((path) => existsSync(path));
  if (memoryFiles.length > 0) {
    const text = readFileSync(memoryFiles[0], 'utf8');
    lines.push('', `memory at the end of rep ${reps[0].rep} (${text.length} chars):`, '', text.trimEnd());
  }
}

// the ablation itself: arms whose names differ only by the on/off suffix
const pairs = [...rollups.keys()]
  .filter((arm) => arm.endsWith('-on'))
  .map((arm) => [arm, `${arm.slice(0, -3)}-off`])
  .filter(([, off]) => rollups.has(off));

if (pairs.length > 0) {
  lines.push('', '## ablation, memory on against memory off', '');
  lines.push(row(['pair', 'gate attempts', 'review tokens', 'total tokens', 'cost', 'wall']));
  for (const [on, off] of pairs) {
    for (const [label, arm] of [
      [on, rollups.get(on)],
      [off, rollups.get(off)],
    ]) {
      lines.push(
        row([
          label,
          String(arm.gateAttempts),
          String(arm.reviewTokens),
          String(arm.totalTokens),
          `$${arm.cost.toFixed(4)}`,
          `${(arm.wallMs / 60000).toFixed(1)} min`,
        ]),
      );
    }
    const a = rollups.get(on);
    const b = rollups.get(off);
    lines.push(
      row([
        'on/off',
        ratio(a.gateAttempts, b.gateAttempts),
        ratio(a.reviewTokens, b.reviewTokens),
        ratio(a.totalTokens, b.totalTokens),
        ratio(a.cost, b.cost),
        ratio(a.wallMs, b.wallMs),
      ]),
      '',
    );
  }
}

process.stdout.write(
  `${lines.join('\n')}\n\ncell: <memory blocks read>b/<lessons written>l <gate attempts>g <outcome>\n`,
);

function ratio(a, b) {
  return b === 0 ? 'n/a' : `${(a / b).toFixed(2)}x`;
}

/** @param {string[]} cells */
function row(cells) {
  return cells.map((c, i) => c.padEnd(i === 0 ? 24 : 22)).join('');
}
