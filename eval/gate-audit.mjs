#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readTrajectory } from '../src/trajectory.mjs';

/**
 * CLI: `node eval/gate-audit.mjs <prefix> [runsDir]`
 *
 * `analyze-k3.mjs` scores the answers; this reads the gate underneath them. For every case in
 * every `runs/<prefix>...-rep<n>` directory it pulls the `gate-attempt` and `gate-outcome` events
 * out of the trajectory and prints, per repetition, how many tests were submitted, the exit-code
 * pair each came back with, and how the run resolved.
 *
 * It is the view the reliability number cannot give: a case proved on the third submission and a
 * case proved on the first both read as `P`, and a control the agent tried to flag four times
 * reads the same as one it never suspected.
 */
const PREFIX = process.argv[2] ?? 'stage1-';
const RUNS_DIR = process.argv[3] ?? 'runs';

/** how a resolution prints in the per-rep cell */
const RESOLUTION = { proved: 'proved', clean: 'clean', withheld: 'withheld' };

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
  /** @type {Map<string, {kind: string|null, cells: string[]}>} */
  const cases = new Map();
  let submitted = 0;
  let revised = 0;
  let rescued = 0;

  for (const run of reps) {
    const dir = join(RUNS_DIR, run.dir);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
      const id = file.replace(/\.jsonl$/, '');
      const events = readTrajectory(join(dir, file));
      const attempts = events.filter((e) => e.type === 'gate-attempt');
      const outcome = events.findLast((e) => e.type === 'gate-outcome') ?? null;

      submitted += attempts.length;
      if (attempts.length > 1) revised += 1;
      if (outcome?.resolution === 'proved' && outcome.passedOn > 1) rescued += 1;

      if (!cases.has(id)) cases.set(id, { kind: null, cells: [] });
      cases.get(id).cells.push(cell(attempts, outcome));
    }
  }

  const controls = [...cases].filter(([id]) => id.includes('control'));
  const flaggedControls = controls.filter(([, c]) => c.cells.some((s) => !s.startsWith('-')));

  lines.push(
    '',
    `## ${arm}  (k=${reps.length})`,
    `gate attempts submitted   ${submitted}`,
    `runs that revised at least once   ${revised}`,
    `proofs that needed a revision     ${rescued}`,
    `controls the agent tried to flag  ${flaggedControls.length}/${controls.length}` +
      (flaggedControls.length ? `  (${flaggedControls.map(([id]) => id).join(', ')})` : ''),
    '',
    row(['case', ...reps.map((r) => `r${r.rep}`)]),
    ...[...cases]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([id, c]) => row([id, ...c.cells])),
  );
}

process.stdout.write(
  `${lines.join('\n')}\n\ncell: <exit codes per attempt, mutant/pristine> resolution; ` +
    '"-" is no test ever submitted\n',
);

/** one repetition of one case: what was submitted, what came back, how it resolved */
function cell(attempts, outcome) {
  const codes = attempts.map((a) => `${a.mutant.code}/${a.pristine.code}`).join(' ');
  const resolution = RESOLUTION[outcome?.resolution] ?? '?';
  return attempts.length === 0 ? `- ${resolution}` : `${codes} ${resolution}`;
}

/** @param {string[]} cells */
function row(cells) {
  return cells.map((c, i) => c.padEnd(i === 0 ? 24 : 30)).join('');
}
