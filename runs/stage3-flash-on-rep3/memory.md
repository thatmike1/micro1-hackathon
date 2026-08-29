# lessons from this review queue

## bytes-12 (bytes) — proved
- Removing the '^' anchor from the parse regex in bytes lets any string ending in a number+unit (e.g. 'foo 2kb') parse successfully; the fallback parseInt path masks this only when the full string isn't a plain number.
- A useful regression test for regex anchoring is to assert parse() returns null for inputs with leading junk before the number/unit, alongside a same-behavior control case like plain '1kb'.

## bytes-15 (bytes) — proved
- The parseInt fallback path silently converts any string that fails the parse regex into a plain byte count (e.g. parse('100mb') returns 100), so a broken regex yields a wrong-but-plausible number rather than null or a throw.
- In the bytes parse regex, restricting a digit group to exactly one digit (\d instead of \d+) still matches most ad-hoc test inputs; separating builds requires a multi-digit value like '100mb' or '10kb', which exercises the single- vs multi-digit branch directly.

## bytes-52 (bytes) — proved
- In bytes' format(), a value whose decimals are stripped by the trailing-zero regexp (1.00 → '1') hides a decimalPlaces regression, while a value with a real fraction (1.5 → '2' at 0 places) exposes it — pick inputs with non-zero fractional output.
- Because format()'s regexp strips trailing zeros and decimal points, an expected value like '1.50KB' with fixedDecimals and '1.5KB' without it are different assertions: the fixed variant survives decimal-stripping and is the stronger check that 2 places were actually applied.
- JavaScript's toFixed(undefined) silently equals toFixed(0), so an options guard that stops checking the specific key (e.g. `options && true` instead of `key !== undefined`) rounds instead of throwing — a classic way one dropped check changes default behavior without any error.

## bytes-control-loop (bytes) — clean
- (nothing new)

## js-yaml-15 (js-yaml) — proved
- A negated character class like [^-+]? is not a way to make a group optional without sign chars — it forbids '-' and '+' outright, so replacing [-+]? with it breaks every signed literal; use (?:-\+)? or drop the group to make it truly optional.
- For js-yaml explicit-tag resolution, a pattern regression surfaces as a YAMLException 'cannot resolve a node with !<tag:yaml.org,2002:int>' rather than a wrong value, so a test asserting the resolved number (e.g. load('!!int "-0b101"') === -5) cleanly separates builds.

## js-yaml-18 (js-yaml) — proved
- In alternation-based regexes, a dropped '?' on an optional sign group ([-+]? → [-+]) only breaks the affected branch (e.g. '+0o7' octal), so a passing control case like an unsigned or minus-signed literal proves nothing — the discriminating input must be the exact sign+prefix combination the mutatio
- When one candidate test is green on both builds, it usually exercised a nearby form rather than the mutated branch; tightening the input to the precise literal the changed alternation matched (here '!!int "+0o7"') is what made the separation pass.

## js-yaml-control-hoist (js-yaml) — clean
- (nothing new)

## ms-12 (ms) — proved
- (nothing new)

## ms-170 (ms) — proved
- (nothing new)

## ms-27 (ms) — proved
- For error-message regressions, a test that asserts the message starts with its descriptive prefix (indexOf(...) === 0) plus a strictEqual on the full expected message catches a dropped string-literal piece of the throw that a generic 'throws Error' assertion would miss; inputs with distinct JSON.str

## ms-30 (ms) — proved
- (nothing new)

## ms-4 (ms) — proved
- (nothing new)

## ms-70 (ms) — proved
- In ms, a year is 365.25 days (ms('1y') === 31557600000), so hand-computed 365-day expectations like 31536000000 fail on the correct build and can't separate anything.
- A dropped `return` inside a shared switch-case group makes earlier units silently fall through into later cases, remapping them to the wrong multiplier — ms('1y') became one week — so a fall-through regression yields a wrong-but-plausible number rather than a throw.
- When a parser has multiple aliases per unit ('y', 'yr', 'years'), one discriminating assertion per alias form is cheap insurance: a fall-through bug can affect all aliases in the case group identically, but only the exact alias the mutation sits on guarantees separation.

## ms-72 (ms) — proved
- (nothing new)

## ms-control-lookup (ms) — clean
- (nothing new)
