# lessons from this review queue

## ms-12 (ms) — withheld
- A test that passes on the changed code and fails on the original can validate a behavioral change, but only if it checks for the correct outcome in both versions, not just the new one.
- When a change removes a type check (like `typeof val === 'string'`), a test should verify that non-string values with `length > 0` are now accepted and processed, even if they result in `undefined`.
- A test must not rely on side effects or assumptions about behavior that aren't explicitly tested; it should assert observable outcomes in both the original and modified code to prove the change is correct.

## ms-4 (ms) — proved
- A test that distinguishes between two builds must assert the expected behavior in the original version and the incorrect behavior in the patched version to prove a change is wrong.
- When a unit of time is defined as a division instead of a multiplication, it results in a value that is orders of magnitude smaller than intended, which can be caught with a simple magnitude check.
- A test can prove a change is incorrect by verifying that a common input like '1y' produces a result that is implausibly small or large compared to the expected real-world duration.

## ms-70 (ms) — proved
- A test that proves a change is incorrect must verify the original behavior is correct and the patched behavior is wrong, not just the new behavior.
- Removing a time unit case (like 'y') from a parser should be tested by confirming that the original behavior (e.g., '1y' → ~365.25 days) is preserved and the new behavior (undefined) is not.
- A test can validate a removal by asserting that a common input like '1y' returns a meaningful value in the original build and fails or returns undefined in the patched build.
