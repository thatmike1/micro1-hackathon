# corpus — silent mutant eval set

12 buggy cases and 3 clean controls over three tag-pinned MIT Node libraries. Every buggy case is
a diff that the library's own full test suite does not notice. Every control is a diff that looks
like a behaviour change and is not one.

Nothing here is asserted by hand. `npm run corpus:verify` re-establishes every claim from the
checked-in diffs on a fresh clone.

## Quick start

```bash
npm run corpus:setup     # clone, install, build, assert every pristine suite green   (~22s)
npm run corpus:verify    # apply every case, run each suite, run the probe            (~5s)
```

`corpus:setup` clones into the gitignored `corpus/.work/` and writes clone URLs and commit SHAs
into `corpus/manifest.json`. Add `--fresh` to discard the checkouts and start over.

## Libraries

| id | repo | tag | entry | suite |
|---|---|---|---|---|
| `ms` | vercel/ms | 2.1.3 | `index.js` | `mocha tests.js`, 49 tests |
| `js-yaml` | nodeca/js-yaml | 5.4.1 | `dist/js-yaml.mjs` | `node --test 'test/core/**/*.test.mjs'`, 314 tests |
| `bytes` | visionmedia/bytes.js | 3.1.2 | `index.js` | `mocha test/`, 30 tests |

The tag pins are load-bearing, not tidiness. `vercel/ms` on `main` today is TypeScript built with
tsdown and tested with jest; the mocha description is true of 2.1.3 only. js-yaml's `dist/` is
build output and untracked, which is why `corpus/verify.mjs` restores the entry module by copying
a pristine snapshot rather than with `git checkout`.

## Case format

Each case is `corpus/cases/<id>/`:

- **`case.json`** — library, tag, mutated file, mutation location and replacement, category,
  distinguishing input, and the expected pristine and mutant observations at that input.
- **`mutation.diff`** — applies to the pinned checkout with `git apply -p1`.

`case.json` is the source of truth; the diff is derived from it. `npm run corpus:make-case`
regenerates every diff from the recorded replacement and fails if the recorded `original` text no
longer matches the span it claims, so the two can never silently drift apart.

Buggy cases carry `kind: "buggy"`; controls carry `kind: "control"` with a null distinguishing
input.

## How cases were generated

**1. Stryker SURVIVED list.** StrykerJS runs over the library's entry module through its *command
runner*, driving the library's own test command. Its plugin runners do not fit these pins:
`@stryker-mutator/mocha-runner@10` declares `peer mocha ">= 7.2 < 13"` and ms 2.1.3 pins mocha
4.0.1, so installing it fails with ERESOLVE, and no runner plugin exists for `node --test` at all.
The command runner costs nothing at this corpus size with `coverageAnalysis: "off"`.

**2. Differential probe screen.** `corpus/probe.mjs` loads the pristine and mutated build side by
side and runs an identical probe corpus over the public API of each, recording the first input
whose observable result differs. Thrown errors count as observations, so a mutation that turns a
value into an exception is a divergence. Every survivor goes through this screen; the ones with no
divergence never enter the set, and the probe's output *is* the distinguishing input written into
`case.json`.

**3. Hand pick for shape.** Discriminability is necessary, not sufficient. Most of ms's
discriminable survivors are case-label or regex-alternation deletions that all collapse to
"returns `undefined`" for one alias, which makes weak, near-identical cases. What was kept instead
is thresholds, constants, fall-throughs, disabled guards and silently ignored options: shapes where
a plausible-looking test still passes on both checkouts.

Regenerate the survivor list and the screen for a library with:

```bash
node corpus/screen.mjs ms          # stryker run + probe screen, ~16s
node corpus/screen.mjs bytes       # ~14s
node corpus/screen.mjs ms --reuse  # re-screen the existing mutation.json only
```

`screen.mjs` installs `@stryker-mutator/core` into the checkout as a devDependency and calls
`./node_modules/.bin/stryker run`. Both details cost spike time and are deliberate: `npx stryker
run` resolves to the legacy `stryker` package from the npx cache and crashes, and Stryker's
TSConfig preprocessor crashes under `npx --yes -p @stryker-mutator/core`.

`screen.mjs` is generation tooling. `verify.mjs` never calls it; the shipped cases carry their own
diffs and Stryker is not needed to verify them.

## The probe corpus is the design

Survivors are cheap. Discriminating them is not, and the yield swings wildly by library:

| library | mutants | killed | survived | discriminable |
|---|---|---|---|---|
| ms 2.1.3 | 177 | 139 | 38 | 35 (92%) |
| bytes 3.1.2 | 146 | 132 | 14 | 6 (43%) |
| js-yaml 5.4.1, `dist/js-yaml.mjs:240-600` | 873 | 744 | 125 | 2 (1.6%) |

The js-yaml row is from the spike and was not re-run here; it takes 8.7 minutes, and both js-yaml
cases are reproduced from that run's recorded mutation location and replacement, then re-verified
end to end by `corpus/verify.mjs`.

That 1.6% is a fact about the probe corpus as much as about the library. Most js-yaml survivors sit
in schema variants only reachable with `{schema: JSON_SCHEMA}` or `CORE_SCHEMA`, and the spike's
corpus never passed one. `corpus/probe-corpus.mjs` sweeps every scalar tag against all five
schemas plus `dump` options, which is what makes the two shipped js-yaml cases reachable at all.
The ms corpus sweeps every unit spelling against both output formats and both sides of every unit
and plural threshold; the bytes corpus sweeps every magnitude threshold against every option
combination.

One trap worth naming: the probe must build each side's schema objects from the module it is
currently calling. Capturing the pristine module's `CORE_SCHEMA` and handing it to the mutant would
route resolution through pristine tag definitions and hide every mutation in that region.

## The equivalent-mutant argument

**"No divergence in the probe set" is not proof of equivalence.** It is evidence bounded by the
corpus. Some survivors are genuinely equivalent and only reading catches it:
`parseInt(value.slice(2), 16)` to `parseInt(value, 16)` is equivalent because `parseInt` accepts
the `0x` prefix at radix 16, and `indexOf('e') < 0` to `<= 0` is equivalent on a
`Number#toString(10)` result, which never starts with `e`.

This cuts both ways, and the two directions have different standards of evidence:

- **For a buggy case**, the probe proves what is claimed. A recorded divergence is a witness: the
  mutant *is* observably different at that input, and the suite *is* green anyway. Nothing rests on
  the absence of evidence.
- **For a control**, the probe cannot prove equivalence, so the controls are not screened
  survivors. Each is a hand-written refactor whose equivalence is argued from the code and then
  checked two ways (suite green, probe silent). The argument for each is recorded in its
  `case.json` `note`:
  - `ms-control-lookup` — the alias `switch` becomes a lookup object. `n * 1` equals `return n` for
    every input the parse regex admits, and a `hasOwnProperty` check preserves the
    `default: return undefined` arm.
  - `bytes-control-loop` — the `mag >= map.pb` if-ladder becomes a loop over an ordered
    `[unit, magnitude]` array with the same descending thresholds and the same `B` fallback.
  - `js-yaml-control-hoist` — `parseYamlInteger` hoists the repeated `value.slice(2)` into a local
    const and renames `value` to `digits`. `String#slice` has no side effects and the hoist happens
    after the sign strip, so every radix branch sees the string it saw before.

Each control sits in the same file its library's mutants come from, so "no defect found" is a real
judgement over a real diff rather than an empty input, and an agent that emits a test failing on a
control's patched side is a hard error rather than a near-miss.

## The cases

| id | library | category | distinguishing input |
|---|---|---|---|
| `ms-4` | ms | constant | `ms('1y')` |
| `ms-12` | ms | guard | `ms(null)` |
| `ms-27` | ms | diagnostic | `ms('')` |
| `ms-30` | ms | guard | a 101-digit string |
| `ms-70` | ms | fall-through | `ms('1y')` |
| `ms-72` | ms | arithmetic | `ms('1y')` |
| `ms-170` | ms | threshold | `ms(1500, {long: true})` |
| `js-yaml-15` | js-yaml | character-class | `load('a: !!int -0b101')` |
| `js-yaml-18` | js-yaml | quantifier | `load('a: !!int 0o17')` |
| `bytes-12` | bytes | anchor | `bytes.parse('  1kb')` |
| `bytes-15` | bytes | quantifier | `bytes.parse('10.5 GB')` |
| `bytes-52` | bytes | option-ignored | `bytes.format(0, {fixedDecimals: true})` |
| `ms-control-lookup` | ms | equivalent-refactor | — |
| `bytes-control-loop` | bytes | equivalent-refactor | — |
| `js-yaml-control-hoist` | js-yaml | equivalent-refactor | — |

**`js-yaml-15` is the designated hard case.** The defect is one character inside a regex
alternation: the explicit-integer pattern's optional sign `[-+]?0b` becomes a negated class
`[^-+]?0b`. All 314 tests pass. Reaching it requires an explicit `!!int` tag carrying a *signed
non-decimal* literal, an input class the suite never generates, so an agent has to work out that
the schema resolver is in play at all. Bare `-0b101` is unaffected, because the implicit pattern
has no binary alternative and treats it as a string either way.

## What verification checks

Per buggy case: the diff applies clean, the library's full suite is green on the mutant, and the
probe's first divergence is exactly the recorded input with the recorded pristine and mutant
observations. A red suite fails the case — that would mean the defect is not silent, which is the
whole premise.

Per control: the suite is green and the probe is silent across the full corpus.

`npm run corpus:verify` prints one verdict line per case and exits non-zero on any failure. Pass
case ids to check a subset: `node corpus/verify.mjs js-yaml-15 ms-170`.

## Files

| file | role |
|---|---|
| `setup.mjs` | clone, install, build, assert pristine suites green, write `manifest.json` |
| `probe.mjs` | the differential probe; also a CLI for probing a checkout you patched by hand |
| `probe-corpus.mjs` | the probe inputs, per library |
| `verify.mjs` | `npm run corpus:verify` |
| `screen.mjs` | generation only: Stryker run plus probe screen of every survivor |
| `make-case.mjs` | generation only: regenerate `mutation.diff` from `case.json` |
| `libraries.mjs` | the pinned library table |
| `case-edit.mjs` | case records and the single-span splice they describe |
| `exec.mjs` | capture a command instead of streaming it |
