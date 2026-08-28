import { inspect } from 'node:util';

/**
 * Probe corpora: fixed input sets the differential probe runs over both the pristine and the
 * mutated build of a library.
 *
 * The corpus is the whole design. A survivor is only usable as a case if some probe input
 * separates it from pristine, so each corpus deliberately sweeps the axes the library's own
 * suite under-covers: every unit spelling and both output formats for `ms`, every magnitude
 * threshold and option combination for `bytes`, and every scalar tag against every schema for
 * `js-yaml` (the spike's js-yaml screen found 2 of 125 survivors discriminable precisely
 * because it only ever probed the default schema).
 *
 * @typedef {object} ProbeCase
 * @property {string} input human-readable call, recorded verbatim as a case's distinguishing
 *   input, so the value in `case.json` is copy-pasteable
 * @property {(mod: any) => unknown} call
 */

/** @param {unknown} value */
function arg(value) {
  return inspect(value, { depth: null, breakLength: Infinity, compact: true });
}

/**
 * @param {string} input
 * @param {(mod: any) => unknown} call
 * @returns {ProbeCase}
 */
function probe(input, call) {
  return { input, call };
}

const MS_UNITS = [
  '', 'ms', 'msec', 'msecs', 'millisecond', 'milliseconds',
  's', 'sec', 'secs', 'second', 'seconds',
  'm', 'min', 'mins', 'minute', 'minutes',
  'h', 'hr', 'hrs', 'hour', 'hours',
  'd', 'day', 'days',
  'w', 'week', 'weeks',
  'y', 'yr', 'yrs', 'year', 'years',
];

const MS_MAGNITUDES = ['1', '2', '1.5', '0.5', '.5', '0', '-1', '-1.5', '100', '365'];

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Every unit threshold, both sides of it, plus both sides of the 1.5x plural threshold. */
const MS_NUMBERS = [
  0, 1, -1, 1.5, 100, 999, SECOND, SECOND + 1,
  1.5 * SECOND - 1, 1.5 * SECOND, 1.5 * SECOND + 1, -1.5 * SECOND,
  MINUTE - 1, MINUTE, MINUTE + 1, 1.5 * MINUTE - 1, 1.5 * MINUTE, 1.5 * MINUTE + 1,
  HOUR - 1, HOUR, HOUR + 1, 1.5 * HOUR - 1, 1.5 * HOUR, 1.5 * HOUR + 1,
  DAY - 1, DAY, DAY + 1, 1.5 * DAY - 1, 1.5 * DAY, 1.5 * DAY + 1,
  7 * DAY, 365.25 * DAY, -DAY, -HOUR, -MINUTE, -SECOND, 2500, -2500, 500000,
];

/** @returns {ProbeCase[]} */
function msCases() {
  const cases = [];
  for (const unit of MS_UNITS) {
    for (const magnitude of MS_MAGNITUDES) {
      const spellings = unit
        ? [`${magnitude}${unit}`, `${magnitude} ${unit}`, `${magnitude}${unit.toUpperCase()}`]
        : [magnitude];
      for (const str of spellings) {
        cases.push(probe(`ms(${arg(str)})`, (ms) => ms(str)));
      }
    }
  }
  for (const str of ['', '  ', 'abc', '1 fortnight', '1sec 1min', 'y', '1'.repeat(101)]) {
    cases.push(probe(`ms(${arg(str)})`, (ms) => ms(str)));
  }
  for (const value of MS_NUMBERS) {
    cases.push(probe(`ms(${arg(value)})`, (ms) => ms(value)));
    cases.push(probe(`ms(${arg(value)}, {long: true})`, (ms) => ms(value, { long: true })));
    cases.push(probe(`ms(${arg(value)}, {long: false})`, (ms) => ms(value, { long: false })));
  }
  for (const value of [NaN, Infinity, -Infinity, null, undefined, [], {}]) {
    cases.push(probe(`ms(${arg(value)})`, (ms) => ms(value)));
  }
  return cases;
}

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
const TB = GB * 1024;
const PB = TB * 1024;

const BYTES_NUMBERS = [
  0, 1, -1, 1.5, 500, KB - 1, KB, KB + 1, 1536, -1536,
  MB - 1, MB, MB + 1, 1.5 * MB, GB - 1, GB, GB + 1, 1.5 * GB,
  TB - 1, TB, TB + 1, 1.5 * TB, PB - 1, PB, PB + 1, 1024 * PB,
  1234567890, -1234567890, NaN, Infinity, -Infinity,
];

const BYTES_OPTIONS = [
  undefined,
  {},
  { decimalPlaces: 0 },
  { decimalPlaces: 1 },
  { decimalPlaces: 3 },
  { fixedDecimals: true },
  { decimalPlaces: 0, fixedDecimals: true },
  { thousandsSeparator: ',' },
  { unitSeparator: ' ' },
  { unit: 'KB' },
  { unit: 'kb' },
  { unit: 'B' },
  { unit: 'zz' },
  { unit: 'PB', decimalPlaces: 4 },
];

const BYTES_STRINGS = [
  '1kb', '1KB', '1 kb', '1.5mb', '-1gb', '+2tb', '1pb', '1024', '0', '-1',
  'abc', '', '1b', '1 b', '1.5', '1e3', '  1kb', '1kb ', '10.5 GB', '.5kb',
  '1.5.5kb', '1TB', '1Pb', '2 PB',
];

/** @returns {ProbeCase[]} */
function bytesCases() {
  const cases = [];
  for (const value of BYTES_NUMBERS) {
    for (const options of BYTES_OPTIONS) {
      const label = options === undefined
        ? `bytes.format(${arg(value)})`
        : `bytes.format(${arg(value)}, ${arg(options)})`;
      cases.push(probe(label, (bytes) => bytes.format(value, options)));
    }
  }
  for (const value of BYTES_STRINGS) {
    cases.push(probe(`bytes.parse(${arg(value)})`, (bytes) => bytes.parse(value)));
  }
  for (const value of [5, NaN, null, undefined, [], {}, '1kb']) {
    cases.push(probe(`bytes(${arg(value)})`, (bytes) => bytes(value)));
  }
  return cases;
}

/**
 * Documents chosen for the mutated `dist/js-yaml.mjs` region: the scalar tag resolvers.
 * Every non-decimal integer form appears both bare and behind an explicit `!!int`, signed
 * and unsigned, because that is the axis one-character regex mutations move.
 */
const YAML_DOCS = [
  'a: 1', 'a: -1', 'a: +1', 'a: 0', 'a: 007', 'a: 1000000',
  'a: 0o17', 'a: -0o17', 'a: +0o17', 'a: 0x1f', 'a: -0x1f', 'a: +0x1f',
  'a: 0b101', 'a: -0b101', 'a: +0b101',
  'a: !!int 5', 'a: !!int -5', 'a: !!int 0o17', 'a: !!int -0o17', 'a: !!int +0o17',
  'a: !!int 0x1f', 'a: !!int -0x1f', 'a: !!int +0x1f',
  'a: !!int 0b101', 'a: !!int -0b101', 'a: !!int +0b101',
  'a: 0o8', 'a: 0b2', 'a: 0xzz', 'a: 1_000', 'a: 1:30',
  'a: 1.5', 'a: -1.5', 'a: .5', 'a: 1e3', 'a: 1.2e+3', 'a: -1.2e-3', 'a: 1.',
  'a: .inf', 'a: -.inf', 'a: .Inf', 'a: .nan', 'a: .NaN',
  'a: !!float 1', 'a: !!float .inf', 'a: !!float -0', 'a: !!float 1e3',
  'a: true', 'a: false', 'a: True', 'a: FALSE', 'a: yes', 'a: no', 'a: on', 'a: off',
  'a: !!bool true', 'a: !!bool yes',
  'a: null', 'a: ~', 'a:', 'a: Null', 'a: NULL', 'a: !!null ~',
  'a: !!str 1', 'a: "1"', "a: '1'", 'a: !!binary "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"',
  'a: 2001-12-14', 'a: 2001-12-14t21:59:43.10-05:00', 'a: !!timestamp 2001-12-14',
  'a: !!set {x, y}', 'a: !!omap [x: 1]', 'a: !!pairs [x: 1]',
  '<<: {a: 1}\nb: 2', 'a: &x 1\nb: *x',
  '- 1\n- 2\n- 0x1f', '{a: 1, b: [1, 0o17]}', 'a: |\n  x\n', 'a: >\n  x\n',
];

const YAML_DUMP_VALUES = [
  1, -1, 0, 1.5, -1.5, 1e21, 1e-7, Infinity, -Infinity, NaN,
  true, false, null, undefined, 'str', '1', 'yes', 'null', '', 'a: b',
  [1, 2, 3], { a: 1, b: [1, 2] }, { a: { b: { c: 1 } } }, new Date(0),
  { z: 1, a: 2 }, [[1], [2]],
];

/**
 * Schemas are referenced by export name and resolved against whichever module the probe is
 * currently calling. Capturing the pristine module's schema objects and handing them to the
 * mutant would route resolution through pristine tag definitions and hide every mutation in
 * this region.
 *
 * @returns {ProbeCase[]}
 */
function jsYamlCases() {
  const schemaNames = [null, 'CORE_SCHEMA', 'JSON_SCHEMA', 'FAILSAFE_SCHEMA', 'YAML11_SCHEMA'];
  const cases = [];
  for (const doc of YAML_DOCS) {
    for (const name of schemaNames) {
      const label = name === null
        ? `load(${arg(doc)})`
        : `load(${arg(doc)}, {schema: ${name}})`;
      cases.push(probe(label, (m) => (name === null ? m.load(doc) : m.load(doc, { schema: m[name] }))));
    }
  }
  /** @type {[string, null|((m: any) => object)][]} */
  const dumpOptions = [
    ['', null],
    ['{flowLevel: 0}', () => ({ flowLevel: 0 })],
    ['{indent: 4}', () => ({ indent: 4 })],
    ['{sortKeys: true}', () => ({ sortKeys: true })],
    ['{noRefs: true}', () => ({ noRefs: true })],
    ['{lineWidth: 10}', () => ({ lineWidth: 10 })],
    ['{forceQuotes: true}', () => ({ forceQuotes: true })],
    ['{quotingType: \'"\'}', () => ({ quotingType: '"' })],
    ['{schema: JSON_SCHEMA}', (m) => ({ schema: m.JSON_SCHEMA })],
    ['{schema: YAML11_SCHEMA}', (m) => ({ schema: m.YAML11_SCHEMA })],
  ];
  for (const value of YAML_DUMP_VALUES) {
    for (const [name, build] of dumpOptions) {
      const label = build === null ? `dump(${arg(value)})` : `dump(${arg(value)}, ${name})`;
      cases.push(probe(label, (m) => (build === null ? m.dump(value) : m.dump(value, build(m)))));
    }
  }
  return cases;
}

/**
 * Build the probe corpus for a library. The corpus is pure data plus closures that take the
 * module under probe, so the identical case list runs against pristine and mutant.
 *
 * @param {string} id
 * @returns {ProbeCase[]}
 */
export function probeCases(id) {
  switch (id) {
    case 'ms':
      return msCases();
    case 'bytes':
      return bytesCases();
    case 'js-yaml':
      return jsYamlCases();
    default:
      throw new Error(`no probe corpus for library: ${id}`);
  }
}
