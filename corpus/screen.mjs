#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { capture, tail } from './exec.mjs';
import { WORK_DIR, checkoutDir, library, pristineEntry } from './libraries.mjs';
import { runProbe } from './probe.mjs';

/**
 * Corpus generation, not corpus verification: runs StrykerJS over a pinned checkout, then
 * screens every SURVIVED mutant through the differential probe and prints the discriminable
 * ones with the input that separates them. Case selection is the hand step after this.
 *
 * `corpus/verify.mjs` does not use this file; the shipped cases carry their own diffs.
 *
 * CLI: `node corpus/screen.mjs <library> [--reuse]`
 *   --reuse  skip the Stryker run and screen the existing reports/mutation/mutation.json
 */

/** Stryker's mocha/node runner plugins do not fit these pins; the command runner does. */
function strykerConfig(lib) {
  return {
    $schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',
    testRunner: 'command',
    commandRunner: { command: lib.test },
    mutate: [lib.mutate],
    coverageAnalysis: 'off',
    concurrency: 4,
    reporters: ['json', 'progress'],
    tempDirName: '.stryker-tmp',
  };
}

/**
 * Splice one Stryker mutant back into the pristine source. Stryker reports 1-based lines and
 * columns, half-open on the end column.
 *
 * @param {string} source
 * @param {{location: {start: {line: number, column: number}, end: {line: number, column: number}}, replacement: string}} mutant
 */
function applyMutant(source, mutant) {
  const lines = source.split('\n');
  const offset = (position) => {
    let index = 0;
    for (let i = 0; i < position.line - 1; i += 1) index += lines[i].length + 1;
    return index + position.column - 1;
  };
  const start = offset(mutant.location.start);
  const end = offset(mutant.location.end);
  return source.slice(0, start) + mutant.replacement + source.slice(end);
}

async function main(argv) {
  const [id, ...flags] = argv;
  if (!id) {
    process.stderr.write('usage: node corpus/screen.mjs <library> [--reuse]\n');
    process.exit(2);
  }
  const lib = library(id);
  const dir = checkoutDir(id);
  const reportPath = join(dir, 'reports/mutation/mutation.json');

  if (!flags.includes('--reuse')) {
    if (!existsSync(join(dir, 'node_modules/@stryker-mutator/core'))) {
      log('installing @stryker-mutator/core (npx resolves the legacy `stryker` package)');
      run('npm install --no-save --no-audit --no-fund --loglevel=error @stryker-mutator/core', dir);
    }
    writeFileSync(join(dir, 'stryker.config.json'), `${JSON.stringify(strykerConfig(lib), null, 2)}\n`);
    log(`stryker run over ${lib.mutate}`);
    const started = Date.now();
    run('./node_modules/.bin/stryker run', dir);
    log(`stryker finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const [file, entry] = Object.entries(report.files)[0];
  const byStatus = entry.mutants.reduce((acc, m) => {
    acc[m.status] = (acc[m.status] ?? 0) + 1;
    return acc;
  }, {});
  const survivors = entry.mutants.filter((m) => m.status === 'Survived');
  log(`${file}: ${entry.mutants.length} mutants, ${JSON.stringify(byStatus)}`);

  const scratchDir = join(WORK_DIR, 'screen', id);
  mkdirSync(scratchDir, { recursive: true });
  writeFileSync(
    join(scratchDir, 'package.json'),
    readFileSync(join(dirname(pristineEntry(id)), 'package.json'), 'utf8'),
  );

  const discriminable = [];
  for (const mutant of survivors) {
    const scratch = join(scratchDir, `m${mutant.id}-${lib.entry.split('/').pop()}`);
    writeFileSync(scratch, applyMutant(entry.source, mutant));
    const result = await runProbe(id, scratch);
    rmSync(scratch, { force: true });
    if (!result.diverged) continue;
    discriminable.push({ mutant, first: result.first, divergences: result.divergences });
  }

  log(`${discriminable.length}/${survivors.length} survivors discriminable`);
  for (const { mutant, first, divergences } of discriminable) {
    const at = `${mutant.location.start.line}:${mutant.location.start.column}`;
    process.stdout.write(
      `\n#${mutant.id} ${mutant.mutatorName} @ ${at} (${divergences} diverging probes)\n` +
        `  replacement: ${JSON.stringify(mutant.replacement)}\n` +
        `  input:       ${first.input}\n` +
        `  pristine:    ${first.pristine}\n` +
        `  mutant:      ${first.mutant}\n`,
    );
  }
}

/**
 * @param {string} command
 * @param {string} cwd
 */
function run(command, cwd) {
  const result = capture(command, cwd);
  if (!result.ok) {
    process.stderr.write(`${tail(result.output, 40)}\n`);
    throw new Error(`\`${command}\` exited ${result.code}`);
  }
}

/** @param {string} message */
function log(message) {
  process.stdout.write(`[screen] ${message}\n`);
}

await main(process.argv.slice(2));
