# lessons from this review queue

## bytes-12 (bytes) — proved
- In bytes' parser, the leading ^ anchor on the parse regex is what makes garbage-prefixed input ('foo 10kb') return null; dropping it lets the regex match a valid suffix anywhere in the string.
- bytes' parse fallbacks differ: when the regex matches, the number in the match is used; when it doesn't, the value goes through parseInt, whose leading-integer semantics produce different results for multi-token input — tests should pin both paths.
- Anchor changes in regexes are easy to review as cosmetic; a candidate-defect test like strictEqual(bytes('foo 10kb'), null) is enough to prove anchoring behavior differs between builds.

## bytes-15 (bytes) — proved
- In bytes' parse regex, quantifier changes on the numeric pattern (e.g. \d+ → \d) silently reroute multi-digit inputs to the parseInt fallback, so a single strictEqual on a multi-digit unit string like bytes('10kb') separates the builds; check that any tightening of a regex's numeric pattern still ac

## bytes-52 (bytes) — proved
- (nothing new)

## bytes-control-loop (bytes) — clean
- (nothing new)

## js-yaml-15 (js-yaml) — proved
- Changing an optional sign group from [-+]? to [^-+]? in a resolver regex both drops the signed forms (which now fail to resolve and throw) and admits arbitrary one-character junk prefixes, so one build can throw while the other parses — either behavior is testable with a single load() call.
- For explicit-tag resolvers, a YAMLException on load() is a clean way to pin the 'rejects' side of a regex change; assert.throws(err.name === 'YAMLException') separates a build that resolves from one that doesn't.
- When a resolver regex is loosened, the fallback parse (e.g. parseInt base 10) can silently give a different value than the original path would have — pin the resolved value, not just non-throwing, to catch wrong-number regressions.

## js-yaml-18 (js-yaml) — proved
- Dropping a '?' from an optional sign group like [-+]?0o to [-+]0o makes the sign mandatory for just that one alternative, so unsigned literals of that base (e.g. 0o7) stop resolving while sibling alternatives still work — a single assert.strictEqual(load('!!int 0o7', { schema: CORE_SCHEMA }), 7) sep
- Quantifier/optionality edits inside one alternation branch of a multi-branch int pattern are easy to miss in review; test each base's unsigned form individually since one branch can regress while the others pass.

## js-yaml-control-hoist (js-yaml) — clean
- In js-yaml's integer parser, parseInt with an explicit radix already ignores 0b/0o/0x prefixes, so hoisting the slice(2) out of the base branches is cosmetic and a value-pinning test across bases and signs cannot separate such refactors from a build that behaves identically.

## ms-12 (ms) — proved
- A loosened typeof guard can let any value with a nonzero .length (arrays, String objects) reach the parse path, because the parser coerces via String() and may still produce a valid result instead of throwing — one assert.throws on ms(['100']) separates such builds.
- Removing a type check can silently change behavior in alternate output paths too (e.g. long formatting) since the non-string now never reaches the throw branch; pin both plain and formatted calls when testing guard removals.

## ms-170 (ms) — proved
- In ms's long formatter, pluralization flips at exactly 1.5 units (n*1.5), so swapping >= for > in the plural check changes the label at the boundary (e.g. ms(90000, {long:true}) is '2 minutes' with >= but '1 minute' with >) — a single strictEqual at the boundary separates the builds.
- Boundary comparisons like >= vs > look cosmetic but shift an output label for exactly one input value per unit; test the exact boundary value (1.5 × the unit) rather than round numbers, which behave identically under both operators.

## ms-27 (ms) — proved
- (nothing new)

## ms-30 (ms) — clean
- (nothing new)

## ms-4 (ms) — proved
- Flipping the arithmetic direction in a unit conversion constant (e.g. y = d*365.25 → d/365.25) breaks both directions at once: parsing that unit collapses by many orders of magnitude, and the formatter's unit-selection thresholds shift so year-scale values format as days — a single strictEqual on ms
- A changed conversion constant in ms should be tested at that unit's exact magnitude (e.g. one year in ms), since round day/minute values are unaffected and hide the defect.

## ms-70 (ms) — proved
- (nothing new)

## ms-72 (ms) — proved
- (nothing new)

## ms-control-lookup (ms) — clean
- Turning a unit-parsing switch into an object lookup introduces prototype-inherited keys (constructor, toString, valueOf) as a new match surface; a hasOwnProperty guard (or Object.create(null)) is what keeps '1 constructor' from returning a number, so one strictEqual on a prototype-key unit string se
