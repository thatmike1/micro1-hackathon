#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CASES_DIR as CORPUS_CASES_DIR } from '../corpus/case-edit.mjs';
import { LIBRARIES, WORK_DIR, checkoutDir, pristineEntry } from '../corpus/libraries.mjs';
import { runProbe } from '../corpus/probe.mjs';
import { SWEEP_CASES_DIR } from './harness.mjs';

/**
 * CLI: `node sweep/build-pool.mjs [library...]`
 *
 * Materialises the widest case pool the corpus assets allow: every SURVIVED Stryker mutant that
 * the differential probe can discriminate, across all three libraries, as a case under
 * `sweep/cases/`. The hand-pick-for-shape step that produced `corpus/cases/` is exactly what is
 * dropped here — the sweep wants the unfiltered pool, including the near-identical
 * "returns undefined for one alias" shapes.
 *
 * Reads `reports/mutation/mutation.json` from each checkout, which `corpus/screen.mjs` leaves
 * behind; run that first for any library whose report is missing. The screen itself is redone
 * here rather than parsed out of the screen's stdout, so every case carries the probe result it
 * was admitted on.
 *
 * The three controls are copied verbatim from `corpus/cases/`, so a sweep run scores false
 * alarms the same way stage 0 did. Nothing under `corpus/cases/` is written.
 *
 * Diffs are not written here: run `node sweep/.harness/corpus/make-case.mjs` afterwards, which
 * is `corpus/make-case.mjs` unchanged, pointed at `sweep/cases/` by the harness symlink.
 */

const CONTROLS = ['ms-control-lookup', 'bytes-control-loop', 'js-yaml-control-hoist'];

/**
 * Byte offset of a 1-based line/column position.
 * @param {string[]} lines
 * @param {{line: number, column: number}} position
 */
function offset(lines, position) {
  let index = 0;
  for (let i = 0; i < position.line - 1; i += 1) index += lines[i].length + 1;
  return index + position.column - 1;
}

/** the exact pristine text a Stryker mutant replaces */
function spanText(source, location) {
  const lines = source.split('\n');
  return source.slice(offset(lines, location.start), offset(lines, location.end));
}

async function main(argv) {
  const wanted = argv.length > 0 ? argv : LIBRARIES.map((l) => l.id);
  mkdirSync(SWEEP_CASES_DIR, { recursive: true });

  const rows = [];
  for (const id of wanted) {
    const reportPath = join(checkoutDir(id), 'reports/mutation/mutation.json');
    if (!existsSync(reportPath)) {
      throw new Error(`no Stryker report for ${id}; run \`node corpus/screen.mjs ${id}\` first`);
    }
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const [, entry] = Object.entries(report.files)[0];
    const pristine = readFileSync(pristineEntry(id), 'utf8');
    if (entry.source !== pristine) {
      throw new Error(`${id}: the Stryker report was taken against a different source than the pristine snapshot`);
    }

    const survivors = entry.mutants.filter((m) => m.status === 'Survived');
    const scratchDir = join(WORK_DIR, 'sweep-screen', id);
    mkdirSync(scratchDir, { recursive: true });
    copyFileSync(join(dirname(pristineEntry(id)), 'package.json'), join(scratchDir, 'package.json'));

    let discriminable = 0;
    for (const mutant of survivors) {
      const original = spanText(pristine, mutant.location);
      const mutated = pristine.slice(0, offset(pristine.split('\n'), mutant.location.start)) +
        mutant.replacement +
        pristine.slice(offset(pristine.split('\n'), mutant.location.end));

      const scratch = join(scratchDir, `m${mutant.id}-${pristineEntry(id).split('/').pop()}`);
      writeFileSync(scratch, mutated);
      const probe = await runProbe(id, scratch);
      rmSync(scratch, { force: true });
      if (!probe.diverged) continue;
      discriminable += 1;

      const caseId = `${id}-${mutant.id}`;
      const record = {
        id: caseId,
        kind: 'buggy',
        library: id,
        tag: LIBRARIES.find((l) => l.id === id).tag,
        file: LIBRARIES.find((l) => l.id === id).entry,
        category: mutant.mutatorName,
        source: `StrykerJS mutant #${mutant.id} (${mutant.mutatorName})`,
        mutation: {
          mutator: mutant.mutatorName,
          location: mutant.location,
          original,
          replacement: mutant.replacement,
        },
        distinguishingInput: probe.first.input,
        expected: { pristine: probe.first.pristine, mutant: probe.first.mutant },
        divergingProbes: probe.divergences,
        inCorpus: existsSync(join(CORPUS_CASES_DIR, caseId)),
        note: `Survivor of the library's own suite, discriminable by the probe at ${probe.first.input}. Admitted by the screen, not hand-picked for shape.`,
      };
      mkdirSync(join(SWEEP_CASES_DIR, caseId), { recursive: true });
      writeFileSync(join(SWEEP_CASES_DIR, caseId, 'case.json'), `${JSON.stringify(record, null, 2)}\n`);
      rows.push(record);
    }
    process.stdout.write(`[pool] ${id}: ${discriminable}/${survivors.length} survivors discriminable\n`);
  }

  for (const control of CONTROLS) {
    const from = join(CORPUS_CASES_DIR, control);
    const to = join(SWEEP_CASES_DIR, control);
    mkdirSync(to, { recursive: true });
    for (const file of ['case.json', 'mutation.diff']) copyFileSync(join(from, file), join(to, file));
  }
  process.stdout.write(`[pool] copied ${CONTROLS.length} controls from corpus/cases\n`);

  const overlap = rows.filter((r) => r.inCorpus).length;
  process.stdout.write(
    `[pool] ${rows.length} buggy cases, ${overlap} of them also in corpus/cases; next: ` +
      'node sweep/harness.mjs && node sweep/.harness/corpus/make-case.mjs\n',
  );
}

await main(process.argv.slice(2));
