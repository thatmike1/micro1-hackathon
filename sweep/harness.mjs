#!/usr/bin/env node
import { cpSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * CLI: `node sweep/harness.mjs`
 *
 * Builds `sweep/.harness/`: a byte-for-byte copy of `src/`, `corpus/` and `eval/` whose
 * `corpus/cases` is a symlink to `sweep/cases/` and whose `corpus/.work` is a symlink to the
 * real checkouts. Running `sweep/.harness/eval/run-eval.mjs` therefore runs the unchanged
 * stage-0 harness — same prompt, same candidate, same scoring — over the sweep pool, without
 * this experiment writing anything into `corpus/cases/`.
 *
 * `sweep/candidates/*.mjs` are copied in beside the real candidates, which is how the sweep's
 * own no-diff arm becomes `--candidate baseline-1-nodiff` to the unchanged runner.
 *
 * The harness is rebuilt from source on every run, so it cannot drift from the code it copies.
 */
export const REPO_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const SWEEP_DIR = join(REPO_DIR, 'sweep');
export const SWEEP_CASES_DIR = join(SWEEP_DIR, 'cases');
export const HARNESS_DIR = join(SWEEP_DIR, '.harness');

/** @returns {string} the harness directory */
export function buildHarness() {
  rmSync(HARNESS_DIR, { recursive: true, force: true });
  mkdirSync(HARNESS_DIR, { recursive: true });
  writeFileSync(join(HARNESS_DIR, 'package.json'), '{ "type": "module", "private": true }\n');

  const corpusCases = join(REPO_DIR, 'corpus', 'cases');
  for (const dir of ['src', 'corpus', 'eval']) {
    cpSync(join(REPO_DIR, dir), join(HARNESS_DIR, dir), {
      recursive: true,
      filter: (from) => from !== corpusCases && !from.startsWith(`${corpusCases}/`) && !from.endsWith('/.work'),
    });
  }
  cpSync(join(SWEEP_DIR, 'candidates'), join(HARNESS_DIR, 'eval', 'candidates'), { recursive: true });

  mkdirSync(SWEEP_CASES_DIR, { recursive: true });
  const harnessCorpus = join(HARNESS_DIR, 'corpus');
  symlinkSync(relative(harnessCorpus, SWEEP_CASES_DIR), join(harnessCorpus, 'cases'), 'dir');
  symlinkSync(relative(harnessCorpus, join(REPO_DIR, 'corpus', '.work')), join(harnessCorpus, '.work'), 'dir');
  return HARNESS_DIR;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`[harness] built ${buildHarness()}\n`);
}
