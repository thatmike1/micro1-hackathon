# lessons from this review queue

## bytes-12 (bytes) — proved
- In `bytes`' parse regex, the `^` anchor is load-bearing: removing it lets leading-garbage strings like 'foo 1kb' match and parse as the unit value instead of returning null.
- bytes('...') on non-unit-bearing strings falls back to parseInt, so a loosened regex changes results like 'abc5mb' from 5 to 5242880 — a comparison against the parseInt fallback is a good oracle for regex-anchor bugs.
- A minimal one-line test (assert.strictEqual(bytes(input), null)) is enough to separate builds when the defect changes null-return behavior, since old and new builds diverge cleanly.

## bytes-15 (bytes) — proved
- Dropping a quantifier while editing a regex (e.g. `\d+` -> `\d`) silently narrows what matches, and the parse path's parseInt fallback then hides the failure as a wrong-but-plausible number rather than null — so tests must assert exact unit-correct values like bytes('10kb') === 10240, not just non-n
- The parseInt fallback in bytes means a regex-narrowing defect turns '10kb' into 10 instead of null, so multi-digit unit inputs with exact expected byte values are the discriminating oracle for regex mistakes in the parser.

## bytes-52 (bytes) — proved
- In bytes' format(), default options are applied via explicit `!== undefined` checks; replacing such a check with a truthiness test on `options` silently drops the default (toFixed(undefined) behaves as toFixed(0)), rounding formatted output to whole numbers.
- Tests asserting exact formatted strings like '1.00KB' or '1.50KB' are a sharp oracle for lost-default defects in format(): the failure shows as a plausible-looking rounded value ('1KB') rather than an error or null.

## bytes-control-loop (bytes) — withheld
- (nothing new)

## js-yaml-15 (js-yaml) — proved
- In js-yaml, negated character classes are a dangerous way to 'loosen' a regex alternation: `[^-+]?` matches any non-sign character, so it both excludes previously-valid signed inputs and admits garbage-prefixed ones.
- A single test can separate builds by asserting an exact parsed value for an edge-case input that the old pattern accepted and the new one rejects — here `load('!!int "-0b101"')` returning -5.
- js-yaml's integer parse path falls through to base-10 parseInt on loosely matched sources, so a loosened pattern yields a plausible wrong number rather than a throw, and tests must assert exact values, not just success.

## js-yaml-18 (js-yaml) — proved
- Editing a regex sign group from `[-+]?` to `[-+]` drops the unsigned alternation form entirely, so inputs like '!!int "+0o7"' can fail via a dropped *branch* rather than a loosened match.
- Not every js-yaml integer regex defect hides behind a wrong number: narrowing the explicit-int pattern makes resolution throw 'cannot resolve a node with explicit tag' instead, so a test expecting a throw (or asserting the exact value) both separates builds cleanly.
- A narrowed explicit pattern surfaces across every schema whose int tag composes the shared resolver (e.g. DUMP_SCHEMA as well as CORE_SCHEMA), so one schema's passing suite does not prove the other is unaffected.

## js-yaml-control-hoist (js-yaml) — clean
- When a parser refactor hoists a shared prefix-slice (e.g. computing source.slice(2) before branching on the prefix), the real risk is the branch that must NOT use the sliced value — here the base-10 fallback needs the signed-stripped whole string, so checking that each branch consumes the right vari
- Behavior-preserving refactors with an empty defect ledger can still be vetted cheaply: enumerate each branch of the original code and confirm the refactor only renames/aliases the intermediate values, rather than hunting for candidate defects at all.

## ms-12 (ms) — proved
- In `ms`, a removed type guard (`typeof val === 'string'`) is masked by duck typing: anything with a truthy `length` (like arrays) gets String()-coerced and parsed, so a plausible wrong result — not a throw — is the changed build's signature.
- A loosened guard in `ms` diverges before the error branch for length-less values (undefined/null throw TypeError instead of the documented Error), but assert.throws(..., Error) still separates builds since TypeError subclasses Error — a passing test may not distinguish which failure mode changed.
- Strings that don't match any unit pattern in `ms`' parse return undefined silently (no throw), so tests on loosened-input paths must assert exact values, not just absence of error.

## ms-170 (ms) — proved
- In `ms`'s plural() the singular/plural boundary is at exactly 1.5×a unit, so an off-by-one operator change (> vs >=) shows up only at inputs like ms(90000) where the rounded count (2) and the plural flag diverge — exact boundary values like 1.5 units are the discriminating oracle.
- A pluralization defect in `ms` produces a plausible-but-wrong string ('2 minute'), not an error, so tests must assert the full exact output including the trailing 's' rather than just checking a number is returned.
- Rounding and singular/plural logic interact in `ms`'s long format: a test that separates builds must hit a duration where Math.round lands on a different value than the boundary comparison — durations that round up from exactly 1.5 units are where the two behaviors fork.

## ms-27 (ms) — proved
- assert.throws(fn, Error) cannot separate builds when a defect changes only an error's message text, not its type — the verifier callback must assert the exact full message string.
- A mangled string concatenation in a throw statement (e.g. `"" + JSON.stringify(val)`) silently drops the descriptive prefix, so callers matching on message text break while the error type is unchanged.
- JSON.stringify erases value identity for non-finite numbers — ms(NaN) stringifies to 'null' — so exact-message tests for invalid numeric input should use a plainly stringifiable value to expose what reached the message.

## ms-30 (ms) — proved
- (nothing new)

## ms-4 (ms) — proved
- (nothing new)

## ms-70 (ms) — proved
- Removing a `return` from a switch case in `ms`' parser makes inputs fall through to the next case's return, so a deleted return yields a plausible wrong multiple (e.g. years computed with the weeks multiplier) rather than an error or null.
- In `ms`' parse, all unit aliases are grouped under one case label (`years/year/yrs/yr/y`), so a defect on that shared branch mis-scales every spelling of the unit — a test on any one alias exposes it, and exact expected values (31557600000 for '1y') are the discriminating oracle against fall-through

## ms-72 (ms) — proved
- (nothing new)

## ms-control-lookup (ms) — clean
- (nothing new)
