#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { capture } from './exec.mjs';
import { CASES_DIR, applyMutation, loadCases } from './case-edit.mjs';
import { library, pristineEntry } from './libraries.mjs';

/**
 * CLI: `node corpus/make-case.mjs [caseId...]`
 *
 * Regenerates `mutation.diff` for the named cases (all of them when none are named) from the
 * replacement recorded in `case.json`, so the diff can never drift from the record. The diff is
 * produced with `git diff --no-index` over two scratch copies, which yields an ordinary `-p1`
 * patch that `git apply` accepts inside the library checkout. That matters for js-yaml, whose
 * `dist/` is build output and untracked, so `git diff` in the checkout would not see it.
 */
async function main(argv) {
  const wanted = new Set(argv);
  const cases = loadCases().filter((c) => wanted.size === 0 || wanted.has(c.id));
  if (cases.length === 0) throw new Error('no matching cases');

  for (const record of cases) {
    const lib = library(record.library);
    if (record.file !== lib.entry) {
      throw new Error(`${record.id}: file ${record.file} is not ${record.library}'s entry module`);
    }
    const pristine = readFileSync(pristineEntry(record.library), 'utf8');
    const mutated = applyMutation(pristine, record.mutation);

    const scratch = mkdtempSync(join(tmpdir(), 'corpus-case-'));
    try {
      for (const [side, content] of [['a', pristine], ['b', mutated]]) {
        const file = join(scratch, side, record.file);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, content);
      }
      const result = capture(
        `git diff --no-index --no-color --no-prefix -- 'a/${record.file}' 'b/${record.file}'`,
        scratch,
      );
      // git diff exits 1 when the files differ, which is the expected case here.
      if (result.code !== 1 || !result.output.startsWith('diff --git')) {
        throw new Error(`${record.id}: git diff --no-index failed\n${result.output}`);
      }
      writeFileSync(join(CASES_DIR, record.id, 'mutation.diff'), result.output);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    process.stdout.write(`[make-case] ${record.id}: wrote mutation.diff\n`);
  }
}

await main(process.argv.slice(2));
