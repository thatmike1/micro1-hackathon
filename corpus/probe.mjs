#!/usr/bin/env node
import { copyFileSync, rmSync } from 'node:fs';
import { inspect } from 'node:util';
import { pathToFileURL } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { checkoutDir, library, pristineEntry } from './libraries.mjs';
import { probeCases } from './probe-corpus.mjs';

/**
 * The differential probe.
 *
 * Loads the pristine and the mutated build of a library as two separate module instances and
 * runs an identical probe corpus over the public API of each, recording the first input whose
 * observable result differs. "Result" includes thrown errors, so a mutation that turns a value
 * into an exception counts as a divergence.
 *
 * This is the screen that decides whether a SURVIVED mutant can enter the corpus at all: a
 * survivor with no divergence is either equivalent or unreachable by any test we could write,
 * and its probe output is exactly the distinguishing input recorded in `case.json`.
 *
 * @typedef {object} Divergence
 * @property {string} input
 * @property {string} pristine rendered pristine result, or `throws: <message>`
 * @property {string} mutant rendered mutant result, or `throws: <message>`
 *
 * @typedef {object} ProbeResult
 * @property {boolean} diverged
 * @property {number} probes number of inputs run against each build
 * @property {Divergence|null} first first divergence in corpus order, or null
 * @property {number} divergences total number of diverging inputs
 * @property {number} ms wall time
 */

const RENDER = { depth: null, breakLength: Infinity, compact: true, sorted: true };

let snapshotCounter = 0;

/**
 * Copy the mutant entry to a path no import has seen before, so it is genuinely re-evaluated.
 *
 * `verify.mjs` probes the same checkout path once per case with different content each time.
 * A `?query` cache-buster is not enough: for the CommonJS entries (`ms`, `bytes`) Node routes
 * the ESM import through the CJS require cache, which is keyed by filename and ignores the
 * query, so every case after the first would silently be handed the first case's module. The
 * copy lands beside the pristine copy, which carries the `package.json` declaring the library's
 * module type.
 *
 * @param {string} id
 * @param {string} mutantEntry
 */
function snapshotMutant(id, mutantEntry) {
  snapshotCounter += 1;
  const snapshot = join(
    dirname(pristineEntry(id)),
    `mutant-${process.pid}-${snapshotCounter}-${basename(mutantEntry)}`,
  );
  copyFileSync(mutantEntry, snapshot);
  return snapshot;
}

/**
 * Import a module by absolute path. CommonJS entries (`ms`, `bytes`) arrive under `default`;
 * ESM bundles (`js-yaml`) are used as the namespace.
 *
 * @param {string} file
 */
async function loadModule(file) {
  const mod = await import(pathToFileURL(file).href);
  const keys = Object.keys(mod);
  return keys.length === 1 && keys[0] === 'default' ? mod.default : (mod.default ?? mod);
}

/**
 * @param {import('./probe-corpus.mjs').ProbeCase} probeCase
 * @param {any} mod
 */
function observe(probeCase, mod) {
  try {
    return `value: ${inspect(probeCase.call(mod), RENDER)}`;
  } catch (error) {
    return `throws: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Run the probe corpus over two builds of the same library.
 *
 * @param {string} id library id
 * @param {string} mutantEntry absolute path of the mutated entry module
 * @param {string} [pristine] absolute path of the pristine entry module; defaults to the copy
 *   `corpus/setup.mjs` stashed outside the checkout
 * @returns {Promise<ProbeResult>}
 */
export async function runProbe(id, mutantEntry, pristine = pristineEntry(id)) {
  const started = Date.now();
  const snapshot = snapshotMutant(id, mutantEntry);
  let pristineMod;
  let mutantMod;
  try {
    [pristineMod, mutantMod] = await Promise.all([loadModule(pristine), loadModule(snapshot)]);
  } finally {
    rmSync(snapshot, { force: true });
  }
  const cases = probeCases(id);

  let first = null;
  let divergences = 0;
  for (const probeCase of cases) {
    const a = observe(probeCase, pristineMod);
    const b = observe(probeCase, mutantMod);
    if (a === b) continue;
    divergences += 1;
    if (!first) first = { input: probeCase.input, pristine: a, mutant: b };
  }

  return {
    diverged: divergences > 0,
    probes: cases.length,
    first,
    divergences,
    ms: Date.now() - started,
  };
}

/**
 * CLI: `node corpus/probe.mjs <library> [mutantEntry]`
 *
 * With no `mutantEntry`, probes the library's current checkout, which is how you check a
 * mutation you just applied by hand. Exits 1 when a divergence is found, so it composes with
 * shell pipelines; `corpus/verify.mjs` calls `runProbe` directly instead.
 */
async function main(argv) {
  const [id, explicitEntry] = argv;
  if (!id) {
    process.stderr.write('usage: node corpus/probe.mjs <library> [mutantEntry]\n');
    process.exit(2);
  }
  const lib = library(id);
  const entry = explicitEntry ?? join(checkoutDir(id), lib.entry);
  const result = await runProbe(id, entry);
  if (!result.diverged) {
    process.stdout.write(`no divergence over ${result.probes} probes (${result.ms}ms)\n`);
    return;
  }
  process.stdout.write(
    `${result.divergences}/${result.probes} probes diverge (${result.ms}ms)\n` +
      `  input:    ${result.first.input}\n` +
      `  pristine: ${result.first.pristine}\n` +
      `  mutant:   ${result.first.mutant}\n`,
  );
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
