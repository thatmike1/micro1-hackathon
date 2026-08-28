import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CORPUS_DIR = dirname(fileURLToPath(import.meta.url));
export const WORK_DIR = join(CORPUS_DIR, '.work');

/**
 * @typedef {object} Library
 * @property {string} id short name, also the checkout directory under `corpus/.work/`
 * @property {string} repo clone URL
 * @property {string} tag git tag the checkout is pinned to
 * @property {string} entry path, relative to the checkout, of the single self-contained
 *   module the probe imports; mutations and controls target this file
 * @property {string[]} build commands run once after `npm install`, before the suite
 * @property {string} test the library's own full suite, run from the checkout root
 * @property {string} mutate Stryker `mutate` glob or range, for regenerating survivors
 */

/** @type {Library[]} */
export const LIBRARIES = [
  {
    id: 'ms',
    repo: 'https://github.com/vercel/ms.git',
    tag: '2.1.3',
    entry: 'index.js',
    build: [],
    test: './node_modules/.bin/mocha tests.js',
    mutate: 'index.js',
  },
  {
    id: 'js-yaml',
    repo: 'https://github.com/nodeca/js-yaml.git',
    tag: '5.4.1',
    entry: 'dist/js-yaml.mjs',
    build: ['npm run build'],
    test: "node --test 'test/core/**/*.test.mjs'",
    mutate: 'dist/js-yaml.mjs:240:1-600:1',
  },
  {
    id: 'bytes',
    repo: 'https://github.com/visionmedia/bytes.js.git',
    tag: '3.1.2',
    entry: 'index.js',
    build: [],
    test: './node_modules/.bin/mocha --reporter dot test/',
    mutate: 'index.js',
  },
];

/**
 * @param {string} id
 * @returns {Library}
 */
export function library(id) {
  const found = LIBRARIES.find((l) => l.id === id);
  if (!found) throw new Error(`unknown library: ${id}`);
  return found;
}

/**
 * Absolute path of the pinned checkout for `id`.
 * @param {string} id
 */
export function checkoutDir(id) {
  return join(WORK_DIR, id);
}

/**
 * Absolute path of the untouched copy of a library's entry module. It is kept outside the
 * checkout so the probe can import pristine and mutant side by side while the mutation is
 * applied in place. `setup.mjs` drops a `package.json` beside it carrying the library's own
 * `type`, because this repo is `"type": "module"` and the CommonJS entries would otherwise be
 * parsed as ESM.
 * @param {string} id
 */
export function pristineEntry(id) {
  const lib = library(id);
  return join(WORK_DIR, 'pristine', id, lib.entry.split('/').pop());
}
