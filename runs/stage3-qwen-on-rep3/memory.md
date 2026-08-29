# lessons from this review queue

## bytes-12 (bytes) — withheld
- A regex with `^` at the start requires the pattern to match from the beginning of the string, while removing `^` allows leading whitespace, which can silently change behavior in ways that break existing expectations.
- Tests that depend on the original behavior must verify that the original does not accept invalid input (like leading spaces) to ensure the change isn't silently breaking callers.
- When a regex change removes anchors like `^` or `$`, it can introduce unintended flexibility—tests should specifically check for such regressions by validating both accepted and rejected inputs.

## bytes-15 (bytes) — clean
- The `exec` method of a RegExp does not require the entire string to match; it returns the first successful match, so `^` at the start of a regex only constrains where the match begins, not whether a match occurs later in the string.
- Even with `^` in a regex, leading whitespace can be ignored if the pattern matches later in the string, meaning the anchor does not prevent partial matches from succeeding.
- When testing regex changes that remove `^` or `$`, it's essential to verify that inputs with leading or trailing noise (like spaces) are rejected in the original build to ensure the change doesn't silently relax validation.

## bytes-52 (bytes) — clean
- When a regex pattern loses its `^` anchor, it may accept inputs with leading whitespace that were previously rejected, and tests must confirm the original behavior explicitly rejects such inputs to ensure the change is intentional and not a regression.
- A test that checks for a behavioral change must validate both the original and patched builds' responses to the same input, especially when the change modifies regex anchors like `^` or `$`.
- Even if a regex with `^` appears to reject inputs with leading spaces, the `exec` method can still return a match if the pattern finds a valid substring later in the string, so tests must verify the full string match behavior, not just partial success.

## bytes-control-loop (bytes) — clean
- When refactoring conditional chains into loops, especially with ordered data, ensure that both versions handle edge cases identically—particularly when the logic relies on strict ordering and early termination.
- A loop-based approach to selecting the largest unit may behave differently than an if-else chain if the data is not strictly ordered or if the loop condition is not equivalent to the original branching logic.
- Tests that aim to detect behavioral differences between a refactored and original implementation must validate that both handle the same inputs identically, even when the control flow is changed, to confirm the refactor is truly equivalent.

## ms-12 (ms) — proved
- A test that verifies a behavioral change must explicitly confirm the original build throws an error (or behaves correctly) and the patched build does not, especially when a condition is weakened (e.g., replacing a type check with `true`).
- When a change replaces a strict type check with a more permissive condition (like `true && val.length > 0`), tests should use objects with a `length` property but not a string to expose the new behavior and verify it differs from the original.
- A test that separates two builds must not only check the patched behavior but also validate that the original behavior (e.g., throwing an error) is preserved, to ensure the change isn't silently breaking expectations.

## ms-170 (ms) — withheld
- When changing a comparison from `>=` to `>` in a pluralization condition, a test must verify that the exact boundary value (1.5×) now returns the singular form instead of the plural, and that the original behavior is preserved for that value.
- A test that checks a behavioral difference in a rounding-based pluralization must use inputs that are exactly on the threshold (e.g., 1.5× the unit) to expose the change in logic, as these values are most sensitive to inequality direction.
- To validate a change in pluralization logic, ensure the test confirms both that the patched build returns the new form (e.g., '1 days') and that the original build does not, by asserting the original's output is not equal to the new form.

## ms-27 (ms) — withheld
- When a test relies on the error message content to detect a behavioral change, it must first verify that the original build produces a non-empty message containing the input value, to ensure the change is not just replacing a meaningful error with an empty one.
- A test that checks for a difference in error messages must confirm both that the original throws with a non-empty message and that the patched version throws with an empty message, to ensure the change is intentional and not a regression in diagnostic quality.
- When modifying an error message to be empty, tests should explicitly validate that the original behavior included the input value in the message, as removing diagnostic information can break debugging even if the functional behavior is unchanged.

## ms-30 (ms) — withheld
- When a condition is replaced with `false`, tests must verify that the original build still rejects invalid inputs (like objects with a `length` property) to confirm the change is not silently relaxing validation beyond the intended scope.
- A test that aims to prove a change in validation logic must explicitly confirm the original build throws an error and the patched build does not, especially when the change disables a length check that previously prevented non-string inputs.
- Even if a change removes a length check, tests should use objects with a `length` property but not a string to ensure the patched build parses the length as a number, and verify this behavior differs from the original's rejection.

## ms-4 (ms) — withheld
- When a unit calculation is inverted (e.g., `d * 365.25` becomes `d / 365.25`), a test must verify that the original build returns the correct large value and the patched build returns a drastically smaller one, ensuring the change is not just syntactic but behaviorally meaningful.
- A test that aims to prove a mathematical change in a library like `ms` must use concrete values (e.g., 1y) and compute expected results independently from the implementation under test, to avoid relying on the same flawed logic in both the test and the code.
- If a test passes on the changed build and fails on the original, it is likely asserting the new behavior instead of the correct one; such tests must be rewritten to first confirm the original behavior is correct before checking that the patch changes it.

## ms-70 (ms) — clean
- When removing support for a unit like 'y' in a time parser, a test must verify that the original build correctly parses the unit (e.g., '1y' → 31557600000) and the patched build returns undefined, ensuring the change is intentional and not a regression.
- A test that confirms a unit is no longer supported must explicitly validate both the original build's correct behavior and the patched build's failure to parse, to distinguish the change from a general parsing failure.
- When a unit is removed from a parser, the test should use a concrete input (like '1y') and an independently calculated expected value for the original behavior to avoid relying on the implementation under test for correctness.

## ms-72 (ms) — withheld
- When inverting a unit conversion (e.g., multiplying by a year's milliseconds to dividing by it), a test must verify the original build returns a large positive value and the patched build returns a very small positive value, ensuring the change is not just syntactic but behaviorally significant.
- A test that aims to detect a mathematical inversion in a time library must compute the expected result independently (e.g., 1 / 31557600000) rather than relying on the implementation under test to avoid circular logic.
- If a test passes on the patched build and fails on the original, it may be asserting the new behavior instead of the correct one; such tests must first confirm the original behavior is correct before verifying the change.

## ms-control-lookup (ms) — clean
- When replacing a switch statement with a lookup object, a test must verify that the original build still supports all valid units and the patched build returns undefined for units that are no longer handled, ensuring the change is not silently weakening validation.
- A test that confirms a unit is no longer supported must use a concrete input and an independently calculated expected value for the original behavior, to avoid relying on the implementation under test for correctness.
- When a change replaces a conditional with a property lookup, tests should validate both that the original behavior is preserved and that the patched build correctly returns undefined for unsupported units, to ensure the change is intentional and not a regression.
