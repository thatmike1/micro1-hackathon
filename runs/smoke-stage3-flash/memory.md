# lessons from this review queue

## ms-12 (ms) — proved
- In ms, a length-only guard is too weak to restore string-only behavior: arrays have a .length and String(['100']) still matches the parse regex, so a separating test should use array input and assert it throws.

## ms-4 (ms) — proved
- (nothing new)

## ms-70 (ms) — proved
- In ms's parse switch, a removed `return` makes a unit case fall through to the next listed unit, so the wrong-unit symptom points one case below where the edit landed.
- Candidate defect lists can carry miscomputed expected values (ms('1y') was listed as 604800000000, a multiple of the week constant); recompute expectations from the library's own constants (365.25 days/year) rather than trusting the candidate's arithmetic.
