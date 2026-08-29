import { cpSync, copyFileSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { CASES_DIR } from '../corpus/case-edit.mjs';
import { capture, tail } from '../corpus/exec.mjs';
import { checkoutDir, library, pristineEntry } from '../corpus/libraries.mjs';

/**
 * How a proved test is materialised and run, per library.
 *
 * `path` is where the candidate's test file lands: the location the library's own runner
 * already looks at, so the proof is scored by the repo's own machinery rather than ours.
 * js-yaml's `command` is its suite command narrowed to that one file; ms and bytes drive
 * the mocha binary the checkout installed for itself.
 *
 * @typedef {object} ProofRunner
 * @property {string} path test file path, relative to the checkout
 * @property {string} command run just that file, from the checkout root
 * @property {string} template a skeleton the candidate is told to fill in, so the import
 *   path and the test dialect are never something it has to guess
 */

/** @type {Record<string, ProofRunner>} */
export const PROOF_RUNNERS = {
  ms: {
    path: 'proof-test.js',
    command: './node_modules/.bin/mocha proof-test.js',
    template: [
      "var assert = require('assert');",
      "var ms = require('./');",
      '',
      "describe('proof', function () {",
      "  it('fails on the patched build', function () {",
      '    // assert the correct behaviour here',
      '  });',
      '});',
    ].join('\n'),
  },
  bytes: {
    path: 'test/proof-test.js',
    command: './node_modules/.bin/mocha test/proof-test.js',
    template: [
      "var assert = require('assert');",
      "var bytes = require('..');",
      '',
      "describe('proof', function () {",
      "  it('fails on the patched build', function () {",
      '    // assert the correct behaviour here',
      '  });',
      '});',
    ].join('\n'),
  },
  'js-yaml': {
    path: 'test/core/proof.test.mjs',
    command: 'node --test test/core/proof.test.mjs',
    template: [
      "import { describe, it } from 'node:test';",
      "import assert from 'node:assert';",
      "import { load, dump } from 'js-yaml';",
      '',
      "describe('proof', () => {",
      "  it('fails on the patched build', () => {",
      '    // assert the correct behaviour here',
      '  });',
      '});',
    ].join('\n'),
  },
};

/** @param {string} libraryId */
export function proofRunner(libraryId) {
  const runner = PROOF_RUNNERS[libraryId];
  if (!runner) throw new Error(`no proof runner for library: ${libraryId}`);
  return runner;
}

/**
 * @typedef {object} Workspace
 * @property {string} root temp directory holding both checkouts
 * @property {string} pristine checkout at the pinned tag, entry module untouched
 * @property {string} mutant the same checkout with `mutation.diff` applied
 * @property {() => void} cleanup remove the whole workspace
 */

/**
 * Build a throwaway pristine/mutant pair for one case.
 *
 * The shared `corpus/.work/<lib>` checkout is never written to: it is copied twice (minus
 * `node_modules`, which is symlinked back, since it is the bulk and nothing under test writes
 * to it), each copy's entry module is reset from the pristine snapshot, and the diff is applied
 * to the mutant copy only. Resetting from the snapshot rather than trusting the shared checkout
 * means a crashed earlier run cannot leak a mutation into a case that follows.
 *
 * @param {import('../corpus/case-edit.mjs').CaseRecord} record
 * @returns {Promise<Workspace>}
 */
export async function prepareCase(record) {
  const lib = library(record.library);
  const source = checkoutDir(record.library);
  const root = await mkdtemp(join(tmpdir(), `silent-mutant-${record.id}-`));

  const pristine = join(root, 'pristine');
  const mutant = join(root, 'mutant');
  for (const dest of [pristine, mutant]) {
    cloneCheckout(source, dest);
    copyFileSync(pristineEntry(record.library), join(dest, lib.entry));
  }

  const diffPath = join(CASES_DIR, record.id, 'mutation.diff');
  const applied = capture(`git apply -p1 -- ${JSON.stringify(diffPath)}`, mutant);
  if (!applied.ok) {
    rmSync(root, { recursive: true, force: true });
    throw new Error(`${record.id}: mutation.diff did not apply: ${tail(applied.output, 3).trim()}`);
  }

  return {
    root,
    pristine,
    mutant,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** copy a checkout without its `node_modules`, then link the original's back in */
function cloneCheckout(source, dest) {
  cpSync(source, dest, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (from) => from !== join(source, 'node_modules'),
  });
  symlinkSync(join(source, 'node_modules'), join(dest, 'node_modules'), 'dir');
}

/**
 * Write a candidate's test into a checkout at the library's proof location.
 * @param {string} checkout
 * @param {import('./workspace.mjs').ProofRunner} runner
 * @param {string} content
 */
export function materialiseTest(checkout, runner, content) {
  const target = join(checkout, runner.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content.endsWith('\n') ? content : `${content}\n`);
  return target;
}

/**
 * Is `candidate` inside one of `roots`? Used to confine `run-command` to the case's own
 * checkouts, so a candidate cannot run commands against this repo or the shared corpus.
 * @param {string} candidate
 * @param {string[]} roots
 */
export function isInside(candidate, roots) {
  const target = resolve(candidate);
  return roots.some((root) => {
    const base = resolve(root);
    return target === base || target.startsWith(base + sep);
  });
}

/**
 * The double run. A candidate's test is written into both checkouts at the library's proof
 * location and run with the library's own runner; only exit codes decide the outcome. Red on the
 * mutant and green on pristine is a proof. Anything else is not, including a test that fails both
 * ways because it does not parse.
 *
 * One definition, used twice: stage 1's gate calls it to decide whether the agent may answer, and
 * `run-eval.mjs` calls it again to score whatever answer comes back. The scorer never takes a
 * candidate's word for its own gate.
 *
 * @param {object} options
 * @param {string} options.library library id, selects the runner
 * @param {Workspace} options.workspace
 * @param {string} options.content complete test file source
 * @param {number} [options.timeoutMs] per-side runner timeout
 * @returns {{path: string, command: string, testFile: string, mutant: {code: number|null, ms: number, tail: string},
 *   pristine: {code: number|null, ms: number, tail: string}, proved: boolean}}
 */
export function doubleRun({ library: libraryId, workspace, content, timeoutMs = 60_000 }) {
  const runner = proofRunner(libraryId);
  const sides = {};
  for (const side of ['mutant', 'pristine']) {
    materialiseTest(workspace[side], runner, content);
    const result = capture(runner.command, workspace[side], { timeoutMs });
    sides[side] = { code: result.code, ms: result.ms, tail: tail(result.output, 12).trim() };
  }
  return {
    path: runner.path,
    command: runner.command,
    testFile: content,
    mutant: sides.mutant,
    pristine: sides.pristine,
    proved: sides.mutant.code !== 0 && sides.pristine.code === 0,
  };
}
