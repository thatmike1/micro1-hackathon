#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES_DIR } from '../corpus/case-edit.mjs';
import { pristineEntry } from '../corpus/libraries.mjs';

const SPIKE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * The composite spike's three cases. Each hides the base case's mutation inside a genuine
 * same-file refactor of the region it lives in, so the diff no longer points at the defect.
 *
 * The span is whole lines of the pristine entry module, 1-based and inclusive; `original` is
 * read from the file rather than typed here, so it cannot drift. The replacement lives in
 * `spike/replacements/<id>.txt`.
 *
 * `distinguishingInput` and `expected` are the base case's, unchanged: the composite must be
 * observably the same defect, which is what makes the baseline scores comparable.
 */
const SPECS = [
  {
    id: 'ms-170-composite',
    base: 'ms-170',
    startLine: 130,
    endLine: 162,
    category: 'threshold',
    note:
      "The long formatter's unit ladder becomes a table-driven loop and `plural` is renamed to " +
      '`pluralize` with the suffix built up separately. Inside that rewrite the plural boundary ' +
      'loses its `=`, so a value exactly on 1.5 units renders singular. Same defect as ms-170, ' +
      'no longer a one-character diff.',
  },
  {
    id: 'bytes-52-composite',
    base: 'bytes-52',
    startLine: 66,
    endLine: 128,
    category: 'option-ignored',
    note:
      "`format` option reading is hoisted into `formatOptions` and the unit ladder into " +
      '`formatUnit`. The hoist reads as faithful but drops the `!== undefined` check on ' +
      '`decimalPlaces`, so the option defaults to `undefined` rather than 2 whenever any ' +
      'options object is passed. Same defect as bytes-52.',
  },
  {
    id: 'js-yaml-15-composite',
    base: 'js-yaml-15',
    startLine: 240,
    endLine: 260,
    category: 'character-class',
    note:
      'The two integer patterns are decomposed into alternation arrays built by ' +
      '`anchoredAlternation`, the radix branches in the parser become a prefix table, and the ' +
      'resolver picks its pattern up front. The binary alternative is written `[^-+]?` instead ' +
      'of `[-+]?` among three sibling fragments that are not. Same defect as js-yaml-15.',
  },
];

/** Byte offset of the start of 1-based `line` in `source`. */
function lineStart(lines, line) {
  let index = 0;
  for (let i = 0; i < line - 1; i += 1) index += lines[i].length + 1;
  return index;
}

for (const spec of SPECS) {
  const base = JSON.parse(readFileSync(join(CASES_DIR, spec.base, 'case.json'), 'utf8'));
  const source = readFileSync(pristineEntry(base.library), 'utf8');
  const lines = source.split('\n');
  if (lines.length <= spec.endLine) throw new Error(`${spec.id}: span runs past end of file`);

  const original = source.slice(lineStart(lines, spec.startLine), lineStart(lines, spec.endLine + 1));
  const replacement = readFileSync(join(SPIKE_DIR, 'replacements', `${spec.id}.txt`), 'utf8');

  const record = {
    id: spec.id,
    kind: 'buggy',
    library: base.library,
    tag: base.tag,
    file: base.file,
    category: spec.category,
    source: `composite of ${spec.base} and a hand-written same-file refactor`,
    mutation: {
      mutator: 'HandWritten',
      location: {
        start: { line: spec.startLine, column: 1 },
        end: { line: spec.endLine + 1, column: 1 },
      },
      original,
      replacement,
    },
    distinguishingInput: base.distinguishingInput,
    expected: base.expected,
    divergingProbes: base.divergingProbes,
    note: spec.note,
  };

  const dir = join(SPIKE_DIR, 'cases', spec.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'case.json'), `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(
    `[author] ${spec.id}: ${spec.endLine - spec.startLine + 1} lines replaced by ` +
      `${replacement.split('\n').length - 1}\n`,
  );
}
