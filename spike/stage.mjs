#!/usr/bin/env node
import { cpSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES_DIR } from '../corpus/case-edit.mjs';

/**
 * CLI: `node spike/stage.mjs on|off`
 *
 * `corpus/case-edit.mjs` resolves cases from `corpus/cases` and nowhere else, and this spike is
 * not allowed to change `corpus/` or `eval/`. So the composite cases are kept in `spike/cases/`
 * and copied into `corpus/cases/` for the duration of a run, which lets `corpus/verify.mjs`,
 * `corpus/make-case.mjs` and `eval/run-eval.mjs` all run completely unchanged — the point of the
 * exercise is baseline 1 unchanged, so the harness around it has to be unchanged too.
 *
 * `off` moves any generated `mutation.diff` back into `spike/cases/` and removes the staged
 * directories, leaving `corpus/cases/` as git found it.
 */
const SPIKE_CASES = join(dirname(fileURLToPath(import.meta.url)), 'cases');
const ids = readdirSync(SPIKE_CASES, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

const mode = process.argv[2];
if (mode !== 'on' && mode !== 'off') throw new Error('usage: node spike/stage.mjs on|off');

for (const id of ids) {
  const staged = join(CASES_DIR, id);
  if (mode === 'on') {
    rmSync(staged, { recursive: true, force: true });
    cpSync(join(SPIKE_CASES, id), staged, { recursive: true });
  } else {
    const diff = join(staged, 'mutation.diff');
    if (existsSync(diff)) renameSync(diff, join(SPIKE_CASES, id, 'mutation.diff'));
    rmSync(staged, { recursive: true, force: true });
  }
  process.stdout.write(`[stage ${mode}] ${id}\n`);
}
