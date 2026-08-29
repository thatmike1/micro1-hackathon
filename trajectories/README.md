# trajectories

Eight recorded runs, chosen to show what changes between an agent that asserts a defect and one
that proves it. Every file here is copied or rendered from a run already committed under `runs/`;
nothing in this directory called a model. Rebuild with `node trajectories/build.mjs`.

Each entry has three files under one stem, named so the stage, engine, repetition and case read off
the filename:

- `<stem>.jsonl` — the raw trajectory, byte for byte from `runs/`
- `<stem>.html` — `src/render-trajectory.mjs`: what the agent did, turn by turn, with the prompt it
  was issued and the text it wrote
- `<stem>-review.html` — `src/render-review-package.mjs`: the diff under review, the hypothesis
  ledger where there was one, every gate attempt with both runners' exit codes and output, the
  verdict, and the corpus's ground truth for the case in a panel of its own

The two pages answer different questions and disagree on purpose. The trajectory page shows what
the agent wrote, including tests it was never made to run. The review page renders a proof **only**
from a gate attempt that passed, so on the stage-0 entries its gate and verdict sections are empty
rules that say so. That gap is the whole point of the set.

Read them in order — the arc runs from a confident claim with nothing behind it to a memory that
teaches the next review the wrong thing.

---

## Stage 0 — the agent asserts

### 1. `stage0-baseline1-flash-rep3-ms-12`

[trajectory](stage0-baseline1-flash-rep3-ms-12.html) ·
[review package](stage0-baseline1-flash-rep3-ms-12-review.html) ·
[raw JSONL](stage0-baseline1-flash-rep3-ms-12.jsonl)

Baseline 1 on `z-ai/glm-5.3-flash`: one prompt, no tools, nothing executed. It reads the diff
correctly — the `typeof val === 'string'` guard collapsed to `true` — writes a fluent note, and
ships a test. Scored `claim-unproved`: the scorer's own double run came back **exit 0 on the
changed checkout and exit 1 on the original**, so the test asserts the *new* behaviour is right and
fails on the library as shipped. Backwards, and nothing in the run could have noticed.

Look at §3 and §4 of the review page — "No gate attempt was recorded: nothing was submitted to be
run" over the claim — then at the test itself on the trajectory page. This is one of the cases that
flips: the same candidate proved `ms-12` in repetitions 1 and 2 and produced this in repetition 3.

### 2. `stage0-baseline1-qwen-rep1-bytes-control-loop`

[trajectory](stage0-baseline1-qwen-rep1-bytes-control-loop.html) ·
[review package](stage0-baseline1-qwen-rep1-bytes-control-loop-review.html) ·
[raw JSONL](stage0-baseline1-qwen-rep1-bytes-control-loop.jsonl)

The same candidate on `qwen3-30b-a3b-instruct-2507`, on a **control** — an if-ladder rewritten as a
loop over the same ordered thresholds, with no behavioural difference at all. It reports a defect
anyway, inventing a boundary bug at 1024 that the code does not have. Scored `false-alarm`.

Worth reading the test source on the trajectory page for its own comments: "the new code **might**
incorrectly use 'B'", "this test **should** catch". The model hedges inside the artefact it is
offering as proof. This is the always-`true` verdict bit the changelog tracks from row 0d onward:
under baseline 1 this engine false-alarmed on both controls in two of three repetitions.

### 3. `stage0b-baseline2-flash-ms-72`

[trajectory](stage0b-baseline2-flash-ms-72.html) ·
[review package](stage0b-baseline2-flash-ms-72-review.html) ·
[raw JSONL](stage0b-baseline2-flash-ms-72.jsonl)

The case row 0b of the changelog is written about. Baseline 2 has `read-file` and `run-command` but
no verification contract. It diagnoses `ms-72` exactly right — the year branch divides where it
should multiply — and then ships a two-assertion test whose second assertion, `ms(ms('1y'))` equals
`'1y'`, is false on the original library too (`ms` formats that as `'365d'`). Scored
`claim-unproved`; the scorer's double run is **exit 2 on the changed checkout, exit 1 on the
original**. Red on both sides is not a proof, and having a shell available did not stop it.

The test source is on the trajectory page. The review page shows the empty gate section, because
this candidate had nothing that would run a test before answering.

All three flash repetitions of the k=3 baseline-2 arm reproduce the shape on this case with a
different wrong assertion: they assert `ms('1y') === 365 * 24 * 60 * 60 * 1000`, missing the
library's `365.25`, and go red on both checkouts again.

---

## Stage 1 — the gate

### 4. `stage1-flash-rep2-ms-27`

[trajectory](stage1-flash-rep2-ms-27.html) ·
[review package](stage1-flash-rep2-ms-27-review.html) ·
[raw JSONL](stage1-flash-rep2-ms-27.jsonl)

The mechanism working. `ms-27` empties an error message's prefix, so a test has to assert the exact
message text. The agent's first two submissions come back **exit 1 / exit 1**, red on both
checkouts — the shape entry 3 shipped. Each rejection returns both runners' output plus a line
naming the failure, and the third attempt passes at **exit 1 / exit 0**. Scored `proved`.

This is the same failure as entry 3, caught instead of shipped, and it is where flash's gain comes
from: 7 of the arm's 34 proofs across three repetitions exist only because the gate rejected a
first answer. Read §3 of the review page top to bottom — three attempts, both runners' tails under
each, and what changed in the test between them.

The set does not contain a stage-1 run that catches `ms-72` this way, because there is not one:
`ms-72` passes the gate on the first attempt in all six stage-1 runs, on both engines.

### 5. `stage1-qwen-rep1-bytes-control-loop`

[trajectory](stage1-qwen-rep1-bytes-control-loop.html) ·
[review package](stage1-qwen-rep1-bytes-control-loop-review.html) ·
[raw JSONL](stage1-qwen-rep1-bytes-control-loop.jsonl)

Entry 2's control, same engine, with the gate in front of the answer. The model still believes the
refactor is defective and spends all four attempts trying to prove it; all four come back **exit 1
/ exit 1**. With no attempt passed, the claim cannot leave the run, and it answers `defect: false`.
Scored `correct`.

Read this against entry 2 and it is exact about what the gate does and does not do. The judgment
did not improve — this engine spent 24 of its 103 stage-1 gate attempts trying to break the two
controls. What changed is that none of them reached the output: false alarms went 2/2, 2/2, 0/2
under baseline 1 to 0/2 in every repetition here.

---

## Stage 2 — the ledger

### 6. `stage2-flash-rep3-ms-170`

[trajectory](stage2-flash-rep3-ms-170.html) ·
[review package](stage2-flash-rep3-ms-170-review.html) ·
[raw JSONL](stage2-flash-rep3-ms-170.jsonl)

The hypothesizer records four ranked candidates before anything is proved — the `>=` to `>` plural
boundary at exactly 1.5 units, then the same regression restated for minutes, hours and days, each
with a concrete call and the two outputs it expects to differ. The prover takes rank 1 and passes
the gate on its first attempt, **exit 1 / exit 0**.

§2 of the review page is the ledger; that section is an empty rule on every stage-0 and stage-1
entry above. This is the ordinary shape of the shipped flash configuration — 34 of its 36 proofs
came from the first-ranked hypothesis — and `ms-170` in particular is a case stage 1 lost: in
`stage1-flash-rep1` it answered `defect: false` with zero gate attempts, and the gate can reject a
test but cannot make the model look.

### 7. `stage2-qwen-rep1-bytes-control-loop`

[trajectory](stage2-qwen-rep1-bytes-control-loop.html) ·
[review package](stage2-qwen-rep1-bytes-control-loop-review.html) ·
[raw JSONL](stage2-qwen-rep1-bytes-control-loop.jsonl)

The third pass over the same control. The hypothesizer records the ledger **empty** on its first
tool call, which ends the review: `resolution: clean, attempts: 0, via: empty-ledger`. Five seconds
and no gate attempt, against entry 5's four attempts and 25 seconds. Scored `correct`.

That is the empty exit doing exactly what it was built for, and the reason it was still dropped on
this engine is on the next page over: qwen also took this exit on 11 of its 30 buggy runs, turning
stage 1's withheld claims into silent misses. A cheap exit is a lever on which way a model's bias
points, not a fix for the bias.

---

## Stage 3 — the memory

### 8. `stage3-qwen-memory-on-rep1-bytes-15`

[trajectory](stage3-qwen-memory-on-rep1-bytes-15.html) ·
[review package](stage3-qwen-memory-on-rep1-bytes-15-review.html) ·
[raw JSONL](stage3-qwen-memory-on-rep1-bytes-15.jsonl) ·
[notebook at end of repetition](stage3-qwen-memory-on-rep1-notebook.md)

Why memory was dropped, in one run. `bytes-15` is the second case of the queue, so it is shown one
block of notes, written by the same model after `bytes-12`. It is the first entry in §2 of the
trajectory page, printed as the raw `memory-read` event, and it reads in part:

> A test that passes on the original but fails on the patch indicates the patch is less strict,
> which contradicts the intent of removing ^ (which should make it more permissive).

The gate passes on exactly that: green on the original, red on the patch. The note tells the next
review that the passing shape is the wrong one.

Two things then go wrong on this page. The run reports "the change removes the `^` anchor from the
regex" — that is `bytes-12`'s mutation, carried over from the notes; `bytes-15` narrows `\d+` to
`\d` in the same regex and keeps the anchor. And after four failed attempts it answers `defect:
false`, scored `miss`. The memory-off arm proved this case in the same repetition in two attempts.

Then read the end of §2, where the scribe's own run appends two more lessons with the direction
reversed — "the original rejects but the patched accepts", "ensure the original fails and the
patched succeeds" — and the notebook file, where they sit in every later prompt of the run. The
scribe never sees the case kind or the score, so nothing is gated on the way in.

One run does not carry the causal claim; the arm-level numbers do. Qwen's memory-on arm went 3/10
proved in every repetition to **0/10**, with cases flipping between repetitions rising 6/10 to
9/10, for 1.34x the cost. On flash the notebook is genuinely good and the metric still does not
move. Both are in CHANGELOG row 3.

Reading the page: it holds **two** runs, the review and the scribe turn that follows it, and the
masthead's particulars describe the last of them — 2 steps, 2.3 s — not the case. The memory events
render as raw transport blocks, because the trajectory renderer has no dedicated treatment for
`memory-read` and `memory-write`; the text is all there, in JSON escaping.

---

## What the eight runs cost

$0.0077 and 78,442 tokens in total, 8 of the 1,112 case runs recorded under `runs/`. The rows in
`CHANGELOG.md` are the measurement; these pages are what the measurement is made of.
