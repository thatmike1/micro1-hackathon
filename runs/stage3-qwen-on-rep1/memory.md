# lessons from this review queue

## bytes-12 (bytes) — clean
- Removing the ^ anchor from a regex makes it match substrings, not just the start of the string, so tests must check for cases where the pattern appears in the middle of a string.
- A test that passes on the original but fails on the patch indicates the patch is less strict, which contradicts the intent of removing ^ (which should make it more permissive).
- When a test fails on both original and patched builds, it likely tests an invariant the library never satisfies, suggesting the test is flawed or the assertion is incorrect.

## bytes-15 (bytes) — clean
- Removing the ^ anchor from a regex allows partial matches, so tests must include strings with leading non-numeric characters to verify the change in behavior.
- A test that passes on both original and patched builds cannot detect behavioral changes, so it must compare outcomes on strings that the original rejects but the patched accepts.
- When testing a relaxation of parsing rules, use inputs with prefix garbage to ensure the original fails and the patched succeeds, confirming the intended permissiveness increase.

## bytes-52 (bytes) — clean
- When a patch changes a default value to use an undefined option directly, tests must verify the difference in behavior by checking the actual output string length or format, especially when toFixed() is called with undefined.
- A test that relies on the presence of decimal places in the output can distinguish between a default of 2 and a fallback to 0 when undefined is passed, even if the difference is subtle.
- If a test fails on both original and patched builds, it may be testing a precondition that is never met by the library, such as expecting a specific string format that only exists under certain conditions.

## bytes-control-loop (bytes) — clean
- When a regex is modified to remove the ^ anchor, tests must include strings with non-numeric prefixes to verify the new permissiveness, as the change enables partial matches within the input.
- If a test fails on both original and patched builds, it may be testing a condition that the library never satisfies—such as expecting a non-null result from a parse function when the input doesn't match any pattern—indicating the test logic is flawed.
- A test that passes on both builds cannot validate a behavioral change; to detect such changes, the test must compare outcomes on inputs that the original rejects (e.g., with garbage prefixes) but the patched version should accept.

## ms-12 (ms) — withheld
- Replacing a condition like `typeof val === 'string'` with `true` in a parser allows non-string inputs with a `length` property to be processed, which can lead to unexpected behavior if the input's `toString()` method returns a valid duration string.
- When a test passes on the original build but fails on the patched build, it indicates the patch has made the behavior more strict, which contradicts the intent of removing a guard condition that was meant to relax parsing.
- A test that fails on both builds likely checks an invariant that the library does not maintain, such as expecting a specific error type or value, suggesting the test is not sensitive to the actual behavioral change being introduced.

## ms-170 (ms) — proved
- A test that fails on both builds may still be valid if it checks for a specific output that the library does not produce under either version, indicating a deeper issue with the test's expectation rather than the code.
- When a change modifies a comparison operator from `>=` to `>`, the difference only manifests at exact boundary values, so tests must target those precise edge cases to detect the behavioral shift.
- A test that passes on the patched build but fails on the original can confirm a change in behavior, but only if it verifies the exact output difference at the boundary where the logic diverges.

## ms-27 (ms) — clean
- When a test passes on the patched build and fails on the original, it indicates the patch made the behavior more permissive, which is expected when removing a strict validation condition like a prefix in an error message.
- A test that checks for a specific error message format must account for changes in message structure; if the original and patched versions differ only in a prefix, the test should verify the core content (e.g., JSON string) rather than the full message.
- If a test fails on both builds despite a change in behavior, it may be testing an invariant that the library never satisfies, such as expecting a specific error message structure that both versions fail to meet.

## ms-30 (ms) — withheld
- When a condition like `if (str.length > 100)` is replaced with `if (false)`, the test must verify that the patched version accepts inputs it previously rejected, especially long strings that trigger the original early return, to confirm the relaxation of input validation.
- A test that fails on both original and patched builds may still be valid if it checks for a specific behavior that neither version satisfies—such as a particular error type or output format—indicating the test is probing an invariant that the library doesn't uphold.
- To detect a change that removes an early exit in a parser, the test must use inputs that would have been rejected by the original (e.g., long strings) and verify that the patched version processes them without error, producing a meaningful numeric result.

## ms-4 (ms) — proved
- A test that passes on the original build but fails on the patched build indicates the patch has made the behavior more strict, which contradicts the intent of a change meant to relax parsing rules or correct a calculation.
- When a mathematical formula is inverted (e.g., multiplication replaced with division), the resulting values can differ by orders of magnitude, so tests must use assertions based on expected magnitude (e.g., > 1e10 vs < 1000) to detect the error.
- A test that passes on the patched build and fails on the original can validate a change in behavior only if it checks for a meaningful difference in output, such as a correct vs. absurd result, rather than just a pass/fail on a single value.

## ms-70 (ms) — withheld
- When a parser removes support for a unit (e.g., 'y', 'yr', 'yrs'), a test must verify that parsing that unit returns undefined in the patched version, especially if the original version returned a large numeric value based on a constant.
- A test that fails on both original and patched builds may still be valid if it checks for a specific output behavior that neither version satisfies, such as a correct result for a now-removed unit, indicating the test is probing a behavioral regression.
- To detect the removal of a parsing rule, the test must compare the outcome of a known input (like '1y') between versions, where the original returns a large number and the patched version returns undefined, confirming the change in behavior.

## ms-72 (ms) — proved
- When a mathematical operation is inverted (e.g., multiplication replaced with division), tests must use magnitude-based assertions (e.g., > 1e10 vs < 1000) to detect the error, as the output difference spans orders of magnitude.
- A test that passes on the patched build but fails on the original can validate a behavioral change only if it checks for a meaningful difference in output, such as a correct vs. absurd result, rather than just a pass/fail on a single value.
- If a test fails on both builds, it may be testing an invariant that the library does not maintain—such as expecting a specific output for a unit that was removed—indicating the test is not sensitive to the actual behavioral change.

## ms-control-lookup (ms) — clean
- When replacing a switch statement with a lookup object, tests must verify that the new structure correctly handles all valid units and returns undefined for invalid ones, as the change can silently preserve or remove behavior depending on key inclusion.
- A test that compares outputs between original and patched builds must use inputs that the original version accepted but the patched version should reject (e.g., '1y' after removal), to confirm the behavioral change is actually present.
- If a test fails on both builds but expects a difference in behavior, it may be testing a condition that the library no longer satisfies—such as a previously valid unit now returning undefined—indicating the test should instead validate the absence of a result rather than a specific value.
