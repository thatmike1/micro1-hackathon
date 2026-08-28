#!/usr/bin/env node
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CASES_DIR, loadCases } from './case-edit.mjs';
import { capture, tail } from './exec.mjs';
import { checkoutDir, library, pristineEntry } from './libraries.mjs';
import { runProbe } from './probe.mjs';

/**
 * CLI: `npm run corpus:verify` (`node corpus/verify.mjs [caseId...]`)
 *
 * Re-establishes every claim the corpus makes, from the checked-in diffs alone.
 *
 * For a buggy case: the diff applies cleanly to the pinned checkout, the library's own full
 * suite stays green on the mutant (that is what makes it a hard case rather than a caught bug),
 * and the differential probe diverges on exactly the recorded input with the recorded pristine
 * and mutant observations.
 *
 * For a control: the suite stays green and the probe stays silent, which is the two-sided
 * evidence that the diff is an equivalent refactor and "no defect found" is a real judgement.
 *
 * Prints one verdict line per case and exits non-zero if any case fails.
 */
async function main(argv) {
  const wanted = new Set(argv);
  const cases = loadCases().filter((c) => wanted.size === 0 || wanted.has(c.id));
  if (cases.length === 0) throw new Error('no matching cases');
  for (const lib of new Set(cases.map((c) => c.library))) {
    if (!existsSync(pristineEntry(lib))) {
      throw new Error(`${lib} is not set up; run \`npm run corpus:setup\` first`);
    }
  }

  const failures = [];
  for (const record of cases) {
    const started = Date.now();
    let verdict;
    try {
      verdict = await verifyCase(record);
    } catch (error) {
      verdict = { ok: false, detail: error.message };
    } finally {
      restore(record.library);
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const mark = verdict.ok ? 'PASS' : 'FAIL';
    process.stdout.write(
      `${mark}  ${record.id.padEnd(22)} ${record.kind.padEnd(8)} ${verdict.detail} (${seconds}s)\n`,
    );
    if (!verdict.ok) failures.push(record.id);
  }

  const buggy = cases.filter((c) => c.kind === 'buggy').length;
  const controls = cases.length - buggy;
  process.stdout.write(
    `\n${cases.length - failures.length}/${cases.length} verified (${buggy} buggy, ${controls} controls)\n`,
  );
  if (failures.length > 0) {
    process.stdout.write(`failed: ${failures.join(', ')}\n`);
    process.exitCode = 1;
  }
}

/**
 * @param {import('./case-edit.mjs').CaseRecord} record
 * @returns {Promise<{ok: boolean, detail: string}>}
 */
async function verifyCase(record) {
  const lib = library(record.library);
  const dir = checkoutDir(record.library);
  restore(record.library);

  const diffPath = join(CASES_DIR, record.id, 'mutation.diff');
  const check = capture(`git apply --check -p1 -- ${JSON.stringify(diffPath)}`, dir);
  if (!check.ok) return fail(`diff does not apply: ${tail(check.output, 3).trim()}`);
  const apply = capture(`git apply -p1 -- ${JSON.stringify(diffPath)}`, dir);
  if (!apply.ok) return fail(`git apply failed: ${tail(apply.output, 3).trim()}`);

  const suite = capture(lib.test, dir);
  if (!suite.ok) {
    return fail(`suite went red on the patched checkout (exit ${suite.code}); not a silent defect`);
  }

  const probe = await runProbe(record.library, join(dir, lib.entry));

  if (record.kind === 'control') {
    if (probe.diverged) {
      return fail(
        `control is not equivalent: ${probe.divergences} probes diverge, first ${probe.first.input}`,
      );
    }
    return { ok: true, detail: `suite green, probe silent over ${probe.probes} inputs` };
  }

  if (!probe.diverged) return fail(`probe found no divergence over ${probe.probes} inputs`);
  if (probe.first.input !== record.distinguishingInput) {
    return fail(
      `first divergence is ${probe.first.input}, case records ${record.distinguishingInput}`,
    );
  }
  if (probe.first.pristine !== record.expected.pristine || probe.first.mutant !== record.expected.mutant) {
    return fail(
      `observations changed: pristine ${probe.first.pristine} / mutant ${probe.first.mutant}`,
    );
  }
  return {
    ok: true,
    detail: `suite green, ${probe.divergences}/${probe.probes} probes diverge on ${record.distinguishingInput}`,
  };
}

/** @param {string} detail */
function fail(detail) {
  return { ok: false, detail };
}

/**
 * Put the checkout's entry module back. Copying the pristine copy rather than `git checkout`
 * is deliberate: js-yaml's `dist/` is build output and untracked, so git would not restore it.
 * @param {string} id
 */
function restore(id) {
  const lib = library(id);
  copyFileSync(pristineEntry(id), join(checkoutDir(id), lib.entry));
}

await main(process.argv.slice(2));
