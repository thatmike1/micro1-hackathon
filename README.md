# silent mutant

A code-review agent that is not allowed to have an opinion. It reviews a diff against a library
whose test suite is fully green, and it may only report a defect it has **proved**: a test it wrote
that fails on the changed checkout and passes on the original, decided by exit codes through a gate
the agent does not control. A claim it cannot prove is withheld as a no-verdict, not shipped as a
comment.

## The thing worth knowing first

The no-execution baseline was measured once and scored **12/12**. It looked like a solved problem.

Then the same baseline ran three more times at a pinned config, against a different question: how
many cases does it prove in *every* repetition. The answer was **7/12**. Five of the twelve
cases flipped between runs, and every one of them proved at least once, so nothing was stably hard
and nothing above 7/12 was stably solved. The single run had not measured the agent, it had drawn
one sample from a distribution and reported the good end of it.

That is the whole premise of the project in one number. An LLM reviewer's confident output is not
evidence of anything, including its own reliability. So the metric here is **cases proved in every
one of k=3 repetitions**, false alarms are hard-zero, and the agent's prose never decides an
outcome: a test process's exit code does.

Every figure below is a row in [`CHANGELOG.md`](CHANGELOG.md), which is the improvement record
stage by stage, including the things that were measured and dropped.

## Who this is for, and what it costs them today

A maintainer taking review load from AI-generated diffs. The volume of changes needing a second
opinion went up; the number of people qualified to give one did not. So the reviewer is offered
an AI reviewer, and hits the actual bottleneck: **verifying the review costs as much as doing it.**

An unverified review comment is worse than silence. Silence costs nothing. A comment that says
"this changes the behaviour of the threshold at line 42" costs a context switch, a read of the
surrounding code, and a decision, whether or not it is true. Get enough false ones and the rational
response is to stop reading them, which also throws away the true ones. The failure mode is not
"the AI is wrong sometimes", it is that the reviewer has no cheap way to tell which comments are
which, so the whole channel loses its value.

This agent makes that check free. Every defect it reports arrives with a test file and two exit
codes. The maintainer runs it, or reads it, and is done in seconds. Everything it could not prove
is marked withheld, which is a request for a human rather than an answer.

## What the gate changed

The corpus is 12 diffs that the library's own suite does not notice, plus 3 clean controls that
look like behaviour changes and are not. The primary metric is cases proved in all three
repetitions. On `z-ai/glm-5.3-flash`:

| stage | what it is | proved in all 3 reps | false alarms |
|---|---|---|---|
| baseline 1 | one prompt, the diff and the changed file, no execution | 7/12 | 0/3 every rep |
| stage 1 | same information, plus a gate it does not control | **10/12** | 0/3 every rep |
| stage 2 | hypothesis ledger written first, then a prover per entry | **12/12** | 0/3 every rep |
| stage 3 | cross-case memory notebook | measured, then **dropped** | n/a |

Stage 2's flash arm is 12/12 in all three repetitions with **zero cases flipping, zero
no-verdicts, zero false alarms and no errors**, at $0.0613 for three repetitions over all 15 cases.
Stage 1 produced **no unproved claim in any of its 81 runs on either engine**: once the gate exists,
the only way one can occur is if the scorer's independent re-run disagrees with the gate, and it
never did.

The strongest single result is on the weaker engine. `qwen/qwen3-30b-a3b-instruct-2507` believes
every diff is a defect; under the baseline it false-alarmed on both controls in two of three
repetitions. Under the gate it still tried, spending 24 gate attempts across the two equivalent
refactors trying to prove a defect in one of them, and **not one of them got through**. False
alarms went to **0/2 in every repetition**. The gate does not fix the model's judgement, it stops
the judgement from reaching the output. Stage 2 then cut those 24 wasted control attempts to **0**,
because a hypothesizer allowed to record an empty ledger ends the review before any test is
written.

Stage 3 gave every role a markdown notebook of lessons from earlier cases in the queue. It was
measured as an on/off ablation on both engines and **dropped on both**: on flash the notebook is
genuinely good (46 of its 58 lessons name a real library symbol, revisions halved) but the metric
was already at its ceiling and the scribe turn costs +13% for no gain; on qwen it went 3/10 to
**0/10**, because that model fills its three-lesson quota after every run, writes the gate's rule
backwards, and then reads its own filler back as fact. A memory inherits the quality of the model's
self-summary, and unlike the test, that summary passes through no gate.

## The shipped configuration is per-engine

**Stage 2 on `z-ai/glm-5.3-flash`. Stage 1 on `qwen/qwen3-30b-a3b-instruct-2507`.** Not a
compromise, a measured split.

The hypothesizer/prover split works by making the model write down what it thinks before it writes
a test, with an empty ledger available as the honest answer for a clean diff. On flash that is what
happens, and the arm closes at 12/12. On qwen the empty ledger is simply the cheapest exit in the
candidate, and the model takes it on the first turn without reading: 11 of its 30 buggy runs ended
on an empty ledger, one of them explaining that the deleted `^` regex anchor "was redundant". Its
always-`true` verdict bit became an always-`false` one. Stage 1's no-verdicts turned into stage 2's
misses (6, 6, 5 per repetition against 3, 1, 2), and that is the wrong direction for this product:
a withheld claim asks for a human, a miss tells the maintainer the change is fine.

So a ranked ledger with a cheap exit is a lever on **which way** a model's verdict bias points, not
a fix for the bias. Which way it moves is the thing to check before shipping it.

## The noise, stated plainly

12/12 is not a hard ceiling and should not be read as one.

Stage 3's two memory-off arms are re-measurements of the shipped candidates with nothing changed
except sequential ordering and no parallelism. Both landed one case below the row they re-measure:
flash's stage-2 row is 12/12 and its off arm is 11/12; qwen's stage-1 row is 4/10 and its off arm
is 3/10. Same code, same pins, fresh sampling. The primary metric carries roughly a case of
variance, which is why every ablation here is scored against its own control arm rather than
against an earlier row.

The other honest limits: the corpus is 12 buggy cases over three small libraries, the k=3
repetition count is small, and provider choice moved qwen's score more than any repetition did
(1/10 to 5/10 across the four usable endpoints serving the same model id, which is why every arm
pins its provider).

## What a reviewer actually opens

`review/` holds four rendered per-case packages, checked in, self-contained HTML with no scripts
and no external requests. Four samples, chosen to show the range: a proof that took three gate
attempts to land, a control where the weaker model claimed a defect and the gate refused all four
of its attempts so nothing shipped, a case stage 1 could not hold that stage 2 closed, and a run
that walked away on an empty ledger.

Each page is one case in seven sections: the change under review, the hypothesis ledger, **the
gate** (every attempt with both runners' output and their exit-code pair, and what changed in the
test between attempts), the verdict with the test file that proved it, what the corpus records as
ground truth (set apart, because the agent never saw it), the instructions as issued, and an
attestation.

The renderer holds one rule that matters: the proof panel renders only from a gate attempt event
with `passed: true`. A confident summary, a final answer, or even a `proved` score never fills that
space. With no passing attempt the page prints an empty rule and says so. The page cannot show you
a proof that did not happen.

Regenerate one with `npm run render:review -- <run-dir> <case-id> -o out.html`.

## How the corpus is built

Every case is a real mutation in a real library that the library's own full suite does not catch.
Nothing is asserted by hand: `npm run corpus:verify` re-establishes every claim from the checked-in
diffs on a fresh clone.

1. **StrykerJS** generates mutants over the entry module through its command runner and reports the
   ones that survive the suite.
2. A differential probe loads the pristine and mutated builds side by side and sweeps the public
   API for the first input whose observable result differs. Survivors with no divergence never
   enter the set, and the probe's output *is* the distinguishing input recorded for the case.
3. Hand pick for shape: thresholds, guards, fall-throughs, disabled options. Cases where a
   plausible-looking test still passes on both checkouts.

The designated hard case is `js-yaml-15`: one character inside the explicit-integer regex,
`[-+]?0b` to `[^-+]?0b`, with all 314 tests green. It is only reachable through an explicit `!!int`
tag carrying a signed non-decimal literal.

The three controls are not screened survivors, because a silent probe cannot prove equivalence.
Each is a hand-written refactor whose equivalence is argued from the code and then checked two
ways. The argument is recorded per case. [`corpus/README.md`](corpus/README.md) has the full
method, the survivor yields per library, and the equivalent-mutant argument.

## Third-party tools and code

- **OpenRouter** for the model API. Both engines run through it with the provider pinned and
  fallbacks off.
- **StrykerJS** (`@stryker-mutator/core`) generates the mutant pool. Generation tooling only:
  `corpus/verify.mjs` never calls it, and the shipped cases carry their own diffs.
- **mocha**, as each library's own test runner at its pinned tag (`ms` and `bytes`). `js-yaml` uses
  `node --test`. The gate runs the library's own command, never one of ours.
- **The libraries under review**, cloned at pinned tags by `npm run corpus:setup`, all MIT:
  [vercel/ms](https://github.com/vercel/ms) 2.1.3, [nodeca/js-yaml](https://github.com/nodeca/js-yaml)
  5.4.1, [visionmedia/bytes.js](https://github.com/visionmedia/bytes.js) 3.1.2.

This repo declares **no dependencies of its own**, runtime or dev. The agent, the gate, the corpus
tooling, the eval harness and both HTML renderers are plain ESM on Node 20+; Stryker and mocha are
installed into the cloned library checkouts, never here.

## Disclosure

Every line in this repository was written during the event: all source, the corpus tooling and
cases, the eval harness, the renderers, and every document including this one. The git history is
the record, beginning 2026-08-28. No code was copied from anything pre-existing. The
third-party software named above is installed as tooling or cloned as the material under review;
none of it is vendored into this repo.

The measurements are the ones that ran. Where a stage did not help it is recorded as dropped with
its numbers intact, and the baseline's flattering single run is still in the changelog next to the
result that replaced it.

## Where to go next

| | |
|---|---|
| [`docs/repro.md`](docs/repro.md) | run it yourself: setup, exact commands, versions, cost |
| [`CHANGELOG.md`](CHANGELOG.md) | the improvement record, one row per stage, with the evidence |
| [`review/`](review/) | four rendered per-case review packages |
| [`corpus/README.md`](corpus/README.md) | how the 15 cases were generated and verified |
| [`docs/dev-notes.md`](docs/dev-notes.md) | the long version, per stage, including what broke |

Everything runs from `npm test`, `npm run corpus:setup`, `npm run corpus:verify` and
`npm run eval:run`; `docs/repro.md` has the exact invocations.
