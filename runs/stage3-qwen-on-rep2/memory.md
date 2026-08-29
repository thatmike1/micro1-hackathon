# lessons from this review queue

## bytes-12 (bytes) — clean
- A regex without ^ or $ anchors matches substrings, not entire strings, which can introduce unintended acceptance of malformed input.
- Tests that aim to prove a change is breaking must assert the original behavior is preserved and the new behavior deviates, not the other way around.
- When verifying a regression in parsing, ensure the test checks that the original rejects invalid input while the new version accepts it, aligning with the gate's expectation of red on patched.

## bytes-15 (bytes) — proved
- A regex pattern that requires a full match must not allow partial or malformed inputs, and changes to such patterns should be tested with edge cases that were previously accepted but now fail.
- When a test is meant to show a change is breaking, it should assert the original behavior is correct and the patched version deviates, not the other way around.
- Parsing floating-point values from strings with suffixes requires careful handling of the entire input string, as partial matches can lead to different results than intended.

## bytes-52 (bytes) — withheld
- A test that claims to prove a change is breaking must verify the original behavior is correct and the patched version differs, not just assert a difference without confirming the original's expected output.
- Using `undefined` as an argument to `toFixed()` defaults to 0 decimal places, which can cause unexpected rounding behavior compared to the intended default of 2 decimal places.
- When a condition like `(options && true)` replaces a meaningful check, it bypasses default logic and can lead to silent behavior changes that are not caught by tests that don't explicitly validate the original default.

## bytes-control-loop (bytes) — clean
- When refactoring conditional logic to use a loop over unit pairs, ensure the loop order matches the original precedence to preserve the intended behavior of selecting the largest applicable unit.
- A test that passes on both original and patched versions cannot prove a change is breaking, even if the change appears to be a structural rewrite; the test must demonstrate a behavioral difference that the original did not exhibit.
- Replaced nested if-else chains with a loop only if the loop maintains the same logical order and conditions, as changes in evaluation order can alter output even when the code appears equivalent.

## ms-12 (ms) — withheld
- A test that fails on both original and patched builds cannot prove a change is breaking, as it indicates the test itself is flawed or the behavior change is not captured.
- When a condition is replaced with a constant `true`, it bypasses critical logic and may introduce silent bugs that only manifest when inputs are expected to be handled by the original condition.
- A test asserting that a patched version fails on valid input must first confirm the original version correctly handles that input, otherwise the test does not prove the change is breaking.

## ms-170 (ms) — clean
- A test that fails on both original and patched builds cannot demonstrate a behavioral change, as it indicates the test is either incorrect or the behavior under test is not affected by the change.
- When a condition is changed from `>=` to `>`, a test must specifically target the boundary value to prove the change affects behavior, and must verify the original behavior is preserved before asserting the patch deviates.
- To prove a change is breaking, a test must first confirm the original version produces the expected output, then assert that the patched version does not, ensuring the test distinguishes between the two builds.

## ms-27 (ms) — proved
- A test that passes on the original but fails on the patched version can prove a change is breaking only if it explicitly verifies the original behavior is correct before asserting the patch deviates.
- When a change modifies error message content, a test must compare the actual message against the expected original string, not just check for non-empty or falsy values, to reliably detect the behavioral difference.
- A test that relies on a partial or incomplete assertion (e.g., failing to complete the error message check) may pass on both builds due to incomplete logic, making it ineffective for proving a change is breaking.

## ms-30 (ms) — withheld
- A test that fails on both original and patched builds cannot prove a change is breaking, as it indicates the test is either incorrect or the behavior under test is unaffected by the change.
- When a condition is replaced with `false`, a test must verify the original behavior is correct before asserting the patched version deviates, otherwise the test cannot distinguish between the two builds.
- A test asserting a change is breaking must first confirm the original version produces the expected output, then assert the patched version does not, ensuring the test captures the intended behavioral difference.

## ms-4 (ms) — proved
- A test proving a change is breaking must first confirm the original behavior is correct by asserting the expected output, then verify the patched version deviates, ensuring the test distinguishes between builds based on actual behavior.
- When a mathematical constant like a year is redefined as a divisor instead of a multiplier, the resulting value is drastically different—this can be detected by testing that the original year-to-milliseconds conversion remains correct.
- A test that passes on the original but fails on the patched version only proves a change is breaking if it explicitly validates the original behavior before asserting the deviation, not just asserting a difference without confirmation.

## ms-70 (ms) — proved
- When a parsing function returns `undefined` for a valid input due to a removed calculation, a test proving the change is breaking must explicitly assert the original expected output (e.g., `31557600000` for '1y') to distinguish the builds.
- A test that passes on the original build but fails on the patched build only proves a change is breaking if it first verifies the original behavior is correct, not just assumes it.
- Removing a multiplier like `y` (365.25 days) from a time parsing function changes the output to `undefined`, which can be detected by a test that confirms the original value was a large number, not just a non-zero or truthy value.

## ms-72 (ms) — proved
- When a time parsing function changes from multiplying by a year constant to dividing by it, the output becomes a very small number, which can be reliably detected by asserting the original large value (e.g., 31,557,600,000 for '1y') is correct on the original build.
- A test proving a change is breaking must explicitly verify the original behavior with a concrete expected value, not rely on the assumption that the original is correct, especially when the change drastically alters the output magnitude.
- To distinguish builds in a time parsing change, test the original behavior with a known large number (like a year in milliseconds) and assert it is preserved, ensuring the patch deviates from that expected value.

## ms-control-lookup (ms) — clean
- A test that passes on both original and patched builds cannot prove a change is breaking, even if the change appears to be a structural rewrite; the test must demonstrate a behavioral difference that the original did not exhibit.
- When replacing a switch statement with a lookup map, ensure the map includes all valid keys from the original cases to preserve behavior, and test that the original behavior is correctly maintained.
- A test asserting a change is breaking must first confirm the original version produces the expected output with a concrete value, not just rely on the assumption that the original is correct, especially when the change affects numerical results like time conversions.
