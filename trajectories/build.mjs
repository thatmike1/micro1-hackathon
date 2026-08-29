#!/usr/bin/env node
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * CLI: `node trajectories/build.mjs`
 *
 * Rebuilds `trajectories/` from the recorded runs under `runs/`. Every entry is one
 * (run directory, case id) pair that already exists in the repository; nothing here calls a
 * model. Each entry produces three files under one stem, so the stage, engine, repetition and
 * case are readable from the filename alone:
 *
 *   <stem>.jsonl        the raw trajectory, copied byte for byte from `runs/`
 *   <stem>.html         `src/render-trajectory.mjs` — what the agent did, step by step
 *   <stem>-review.html  `src/render-review-package.mjs` — the diff, the ledger, every gate
 *                       attempt with both runners' exit codes, and the corpus's ground truth
 *
 * Adding an entry means adding a row to ENTRIES and a paragraph to README.md. The renderers are
 * owned elsewhere and are used as they are.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/**
 * `also` copies further files out of the run directory under an explicit name, because a
 * run-level artefact (the memory notebook) belongs to the repetition, not to one case.
 *
 * @type {{stem: string, run: string, caseId: string, also?: Record<string, string>}[]}
 */
const ENTRIES = [
  { stem: 'stage0-baseline1-flash-rep3-ms-12', run: 'day2-baseline-1-flash-rep3', caseId: 'ms-12' },
  {
    stem: 'stage0-baseline1-qwen-rep1-bytes-control-loop',
    run: 'day2-baseline-1-qwen-rep1',
    caseId: 'bytes-control-loop',
  },
  {
    stem: 'stage0b-baseline2-flash-ms-72',
    run: 'stage0-baseline-2-2026-08-28T18-56-15',
    caseId: 'ms-72',
  },
  { stem: 'stage1-flash-rep2-ms-27', run: 'stage1-flash-rep2', caseId: 'ms-27' },
  {
    stem: 'stage1-qwen-rep1-bytes-control-loop',
    run: 'stage1-qwen-rep1',
    caseId: 'bytes-control-loop',
  },
  { stem: 'stage2-flash-rep3-ms-170', run: 'stage2-flash-rep3', caseId: 'ms-170' },
  {
    stem: 'stage2-qwen-rep1-bytes-control-loop',
    run: 'stage2-qwen-rep1',
    caseId: 'bytes-control-loop',
  },
  {
    stem: 'stage3-qwen-memory-on-rep1-bytes-15',
    run: 'stage3-qwen-on-rep1',
    caseId: 'bytes-15',
    also: { 'memory.md': 'stage3-qwen-memory-on-rep1-notebook.md' },
  },
];

const node = (script, args) =>
  execFileSync(process.execPath, [join(ROOT, script), ...args], { cwd: ROOT, encoding: 'utf8' });

const manifest = [];
for (const { stem, run, caseId, also = {} } of ENTRIES) {
  const source = join(ROOT, 'runs', run, `${caseId}.jsonl`);
  if (!existsSync(source)) throw new Error(`missing trajectory: runs/${run}/${caseId}.jsonl`);

  copyFileSync(source, join(HERE, `${stem}.jsonl`));
  node('src/render-trajectory.mjs', [
    `runs/${run}/${caseId}.jsonl`,
    '-o',
    `trajectories/${stem}.html`,
  ]);
  node('src/render-review-package.mjs', [
    `runs/${run}`,
    caseId,
    '-o',
    `trajectories/${stem}-review.html`,
  ]);

  const extras = Object.entries(also).map(([name, to]) => {
    const from = join(ROOT, 'runs', run, name);
    if (!existsSync(from)) throw new Error(`missing extra: runs/${run}/${name}`);
    copyFileSync(from, join(HERE, to));
    return to;
  });

  manifest.push({ stem, run, caseId, extras });
  process.stdout.write(`${stem}  <-  runs/${run}/${caseId}.jsonl\n`);
}

writeFileSync(join(HERE, 'manifest.json'), `${JSON.stringify({ entries: manifest }, null, 2)}\n`);
process.stdout.write(`${manifest.length} entries\n`);
