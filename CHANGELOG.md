# improvement changelog

Each row is one iteration on the agent: what changed, the evidence that it helped or did not, and
what was decided as a result.

| stage | what & why | evidence | decision |
| --- | --- | --- | --- |
| 0 | scaffold: agent loop, trajectory logging, HTML render | `npm test` (14 passing), `runs/demo.jsonl`, `runs/smoke-2026-08-28T17-15-15.jsonl` | baseline in place |
| 0 | baseline 1: one prompt, no tools, no execution (`eval/candidates/baseline-1.mjs`) over all 15 cases | `runs/stage0-baseline-1-2026-08-28T18-56-11/`: proof rate **12/12**, false alarms **0/3**, $0.0478, 212k tokens, 6.4 min wall (4 cases in parallel) | the corpus does not discriminate this model: reading the diff is enough, including the designated hard case `js-yaml-15`. Nothing above stage 0 can show a proof-rate gain here |
| 0b | baseline 2: same prompt plus `read-file` and `run-command`, no verification contract (`eval/candidates/baseline-2.mjs`) | `runs/stage0-baseline-2-2026-08-28T18-56-15/`: proof rate **9/12**, false alarms **0/3**, $0.0358, 466k tokens, 13.8 min wall | tools made it worse, not better: 2 js-yaml cases burned all 12 steps exploring and never answered, and `ms-72` shipped a test that was also red on pristine (`ms(ms('1y'))` is `'365d'`, not `'1y'`). The double-run gate caught that one, which is the case stage 1 exists to fix |
| 0c | composite-diff spike: hide each of three existing mutations inside a genuine same-file refactor of the region it lives in, to test whether diff size is what baseline 1 is reading | `docs/composite-spike.md`, `runs/composite-baseline-1-rep1/`, `runs/composite-baseline-1-rep2/`: proof rate **3/3 both reps**, false alarms **0/1 both reps**, $0.0457, ~10% more tokens per case than the base cases | removed — the hypothesis is wrong for this model. Burying the mutation in a real refactor does not move the proof rate at all, and the notes separate the equivalent half of each refactor from the defect by name, so diff size is not the axis that separates candidates |
| 0d | frontier sweep: the widest pool the corpus assets allow (every discriminable survivor, 70 buggy cases + 3 controls, 73/73 verified) against baseline 1 unchanged, 2 reps, on three models, plus a no-diff ablation on flash | `docs/frontier-sweep.md`, `runs/sweep-*/`: flash **69/70 and 68/70**, 0/3 false alarms; `qwen3-30b-a3b` **25/70 and 27/70** (25-27/41 on ms+bytes, 0/58 on js-yaml), 3/3 false alarms, 10 ms+bytes cases flipping between reps; `mistral-small-3.2` 11-13/70; no-diff flash **8/10** without the diff at all; $0.92 total | no honest corpus v2 comes out of this pool (widening it raised flash's rate), but `qwen3-30b-a3b-instruct-2507` over the ms+bytes half is a frontier tier with zero misses, all-near-miss failures and an always-`true` verdict bit. Acted on in row 0e: it is the frontier engine, flash is the control |
| 0e | engine verification: does `qwen3-30b-a3b-instruct-2507` emit real tool calls, and on which endpoint? `scripts/tool-call-probe.mjs` drives the real agent loop once per provider that declares `tools`, pinned with `require_parameters: true` | `runs/toolprobe-qwen3-30b-a3b-instruct-2507/`, `runs/toolprobe-glm-5.3-flash/`: **5/5 providers** emit well-formed calls and finish the two-step scenario correctly; flash on Z.AI at effort low likewise. Provider check over the 12 ms+bytes cases, one rep each: CoreWeave **5/10**, SiliconFlow 4/10, Nebius 3/10, Alibaba 1/10, StreamLake unusable (12/12 HTTP 429) | engine pair settled as the sweep recommended: solution stages run on qwen (frontier, ms+bytes only) and on flash (saturated control). The Luna effort-dial fallback is not needed. Pins: qwen on CoreWeave with no `reasoning` field (no endpoint declares the parameter; sending one under `require_parameters` is HTTP 404), flash on Z.AI at effort low |
| 0f | canonical stage-0 baselines re-measured at the pinned configs, k=3 repetitions per arm, primary metric = cases proved in EVERY repetition (`eval/run-baselines-k3.sh`, `eval/analyze-k3.mjs`) | `runs/day2-*`: baseline 1 flash 11/12, 11/12, 9/12 single-run → **7/12 in all three**, 0/3 false alarms every rep; baseline 2 flash 5/12, 7/12, 11/12 → **3/12**, 8 of 12 cases flipping; baseline 1 qwen 5/10 three times → **5/10**, zero misses, false alarms 2/2, 2/2, 0/2 (repetition 3 is not two correct answers: both controls were runaway generations that never produced a verdict); baseline 2 qwen 4/10, 5/10, 2/10 → **2/10** with a miss in every rep. $0.2482 for step 2 | the reliability metric has real headroom on both engines and the single-run number was hiding it: flash's "12/12" is 7/12 when it has to hold three times. Stage 1 measures against these four rows. One config change is owed first: the harness sends no `max_tokens`, and three qwen generations ran to the 65,536-token cap at $0.02 and ~10 min each |
| 1 | stage 1: prover loop with a double-run gate (`eval/candidates/stage-1.mjs`). Baseline 1's information plus one tool it does not control: the harness runs its test on both checkouts, reads exit codes only, and returns both runners' output on a failure, max 3 revisions. The gate produces the answer — an unproved claim is withheld as a no-verdict. `--max-tokens 4096` pinned, per row 0f | `runs/stage1-*`, `node eval/analyze-k3.mjs stage1-`, `node eval/gate-audit.mjs stage1-`: flash 11/12, 12/12, 11/12 single-run → **10/12 in all three** (baseline 1: 7/12), 0/3 false alarms every rep; qwen 5/10, 6/10, 5/10 → **4/10** (baseline 1: 5/10), **0/2 false alarms every rep** against 2/2, 2/2, 0/2. Zero unproved claims in all 81 runs, both engines. $0.1028, 1.50M tokens | keep it. Flash gains three cases on the primary metric for 1.5x the cost; qwen trades one case for its entire false-alarm rate, which the plan treats as hard-zero. 7 of flash's 34 proofs came only after the gate rejected a first answer. Qwen's always-`true` verdict bit is intact — it spent 24 gate attempts trying to prove the two controls defective — but none got through, so it no longer reaches the output. The cap fired 9 times on qwen and needed a loop fix: a truncated tool call echoed back was an HTTP 400 and killed the run |
| 2 | stage 2: hypothesizer/prover split (`eval/candidates/stage-2.mjs`). One role reads the diff and records a ranked ledger of candidate defects, or records it empty and ends the review; a second role takes one entry at a time and tries to prove it through the stage-1 gate, two attempts per entry out of the same four-attempt total, falling to the next entry when they are spent. Gate, metric, case slices, engines and `--max-tokens 4096` all unchanged; the gate itself is now one module (`eval/gate.mjs`) both stages import, and stage 1's request body is byte-identical after the extraction | `runs/stage2-*`, `node eval/analyze-k3.mjs stage2-`, `node eval/gate-audit.mjs stage2-`, `node eval/ledger-audit.mjs stage2-`: flash 12/12, 12/12, 12/12 single-run → **12/12 in all three** (stage 1: 10/12), 0/3 false alarms every rep, zero flips, zero no-verdicts, 45 gate attempts against stage 1's 48. Qwen 4/10, 4/10, 5/10 → **3/10** (stage 1: 4/10), 0/2 false alarms every rep, zero no-verdicts, but misses 6, 6, 5 against stage 1's 3, 1, 2. Qwen's control gate attempts went 24 → **0**: all six control runs exited on an empty ledger. $0.0613 flash / $0.0407 qwen, 1.92M tokens | **split.** Keep on flash: the two cases stage 1 could not hold (`ms-30`, `ms-170`) are stable, the arm is now clean on every case in every repetition, for 1.8x stage 1's tokens and 2.5x its cost. Drop on qwen and keep stage 1 as the shipped configuration there: the empty-ledger exit cut the wasted control attempts to zero as intended, but this model takes it on the first turn without reading — it ends 11 of 30 buggy runs clean, and the always-`true` verdict bit becomes an always-`false` one. Trading stage 1's no-verdicts for misses is the wrong direction: a withheld claim asks for a human, a miss ships the defect |
| 3 | stage 3: cross-case memory file (`eval/candidates/stage-3.mjs`, `eval/memory.mjs`). One markdown notebook per run: every role is shown what it holds before the review, and after the verdict settles a scribe turn reads the diff, the ledger, each gate attempt's exit-code pair and the test that passed or last failed, and appends at most three one-sentence lessons. It never sees the case kind or the scorer's outcome, so a wrong lesson propagates. Measured as an on/off ablation over the shipped stage of each engine per row 2 — base stage 2 on flash, stage 1 on qwen — at `--concurrency 1` in a fixed recorded order (`bytes-12 → bytes-15 → bytes-52 → bytes-control-loop → [js-yaml-15 → js-yaml-18 → js-yaml-control-hoist →] ms-12 → ms-170 → ms-27 → ms-30 → ms-4 → ms-70 → ms-72 → ms-control-lookup`, js-yaml on flash only), both arms. Gate, budget, slices, engines and `--max-tokens 4096` unchanged; `eval/stage-3.test.mjs` compares request bodies byte for byte against stages 1 and 2 and they are identical with the memory empty | `runs/stage3-*`, `node eval/analyze-k3.mjs stage3-`, `node eval/gate-audit.mjs stage3-`, `node eval/memory-audit.mjs stage3-`: flash off 12/12, 12/12, 11/12 → **11/12 in all three**, 0/3 false alarms every rep, 46 gate attempts, $0.0721; flash on 12/12, 11/12, 12/12 → **11/12**, 0/3 false alarms, but one no-verdict on a control, **39** gate attempts, revisions 9 → 4, review tokens −5%, total tokens +6%, $0.0816 (**+13%**). Qwen off 6/10, 3/10, 6/10 → **3/10**, 109 attempts, $0.0927; qwen on 3/10, 5/10, 1/10 → **0/10**, flips 6/10 → 9/10, 125 attempts, 1.5x tokens, $0.1242. False alarms 0/2 every rep in both qwen arms. $0.3773, 5.14M tokens | **drop on both engines**, shipped configuration unchanged (stage 2 on flash, stage 1 on qwen). On flash the notebook is genuinely good — 46 of 58 lessons name a library symbol, every proof came from the first-ranked hypothesis, revisions halved — but the metric was already at its ceiling and the scribe turn costs more than the attempts it saves. On qwen the scribe fills its three-lesson quota after all 36 runs, 54 of 108 lessons open with "A test that…", only 37 name a library symbol, and several state the gate's direction backwards ("the original rejects but the patched accepts"); those are then in every later prompt of the run. A memory inherits the quality of the model's self-summary and, unlike the test, that summary passes through no gate. Both off arms also land one case below the row they re-measure (flash 12/12 → 11/12, qwen 4/10 → 3/10) on an unchanged candidate under the sequential order |

## where this fails

The gate is only as good as the corpus's ability to tell two answers apart, and that is the
constraint everything above ran into.

**Discriminability is the scarce resource, not model capability.** The corpus took a full day to
build and the first stage-0 measurement scored 12/12 against it — a result that reads as a solved
problem and is really a statement about the corpus. Widening the pool made it worse, not better:
the frontier sweep put 70 buggy cases and 3 controls in front of the same unchanged baseline and
flash went *up*, to 69/70. Every mutation a mutation testing tool will generate is either caught by
reading the diff or caught by nothing, and the band in between — a defect a competent reviewer
would miss and a test can still separate — is thin enough that 73 verified cases yielded roughly a
dozen worth arguing about. The scarce thing was never a better agent. It was a case that two
candidates answer differently.

That has a consequence the numbers here inherit. A 12-case slice cannot resolve a difference
smaller than about one case, which is also the size of the run-to-run noise measured in row 3. Every
comparison in this changelog above that resolution is real; anything at or below it is a coin the
corpus is not big enough to call, and it is reported rather than rounded.

**The failure mode in production is narrower and more honest than the one in evaluation.** The agent
cannot prove what a test cannot separate. A defect needs a green suite to start from, a runnable
checkout of both sides, and behaviour reachable from the library's public surface — and where any of
those is missing the gate returns no-verdict rather than a wrong answer. That is the trade the whole
design makes: it converts most of the reviewer's false positives into silence. Silence is cheap and
a false positive is not, but silence is still not a review, and a run that withholds every case has
told the maintainer nothing while looking exactly like a run that found nothing wrong.

**The gate proves separation, not intent.** It runs the submitted test on two checkouts and reads
exit codes, so what it verifies is that the test separates the builds — not that it separates them
for the reason the review claims. The checkouts sit at `<tmp>/mutant` and `<tmp>/pristine`
(`eval/workspace.mjs`), each with the source checkout's `node_modules` symlinked back in, and the
test runs with the harness's full process rights. A test could therefore read `__dirname`, grep the
entry file for the diff it was handed, write into the sibling checkout, or touch the shared
`node_modules`, and come back red on one side and green on the other with no behavioural content in
it at all. That is the honest boundary of the claim this repo makes: the engines here are
cooperative, and the review package puts the test in front of a human precisely because the gate
cannot read intent. A timeout is the same shape of gap in miniature — `capture` returns
`code: null` when a run is killed (`corpus/exec.mjs`) and the pass condition is
`mutant.code !== 0 && pristine.code === 0`, so a test that hangs on the changed checkout and exits
clean on the original proves. Arguably the right behaviour, but "exit codes and nothing else"
slightly overstates what is being read. Neutral directory names, a `node_modules` per side, and
running the submitted test under a sandbox would close most of the first gap; all three rewrite the
substrate every arm above was measured on, so none was changed inside the event.

**Three harness fixes landed after the last measurement, none of them on a measured path.** Both
`settle` functions overwrote `stopReason` with `final`, so a transport error surviving retries would
have been scored as a no-verdict with a parser message instead of an error, losing the API error
from `summary.json`; `parseVerdict` scanned unfenced JSON candidates first-to-last while scanning
fenced ones last-to-first; and the `.env` reader stored a garbage entry for a line with no `=`. The
first is the only one that could have touched a number, and no committed run reached it: no
trajectory under `runs/stage1-*`, `runs/stage2-*` or `runs/stage3-*` contains
`"stopReason":"error"`, and the baseline candidates that did see transport errors never call
`settle`. The second is unreachable while a model honours the fence contract, which every shipped
path does. Nothing above was re-run, and none of the three changes a request body.

**What we would build next, in order.** A discriminability probe that scores a candidate case
*before* it enters the corpus, so the build day spends itself on the thin band instead of
discovering it afterwards. Then a second gate direction — a test that must pass on the mutant and
fail on pristine — which would catch the backwards proofs that stage 0 shipped and stage 1 only
rejects. Then the ablation this run could not afford: the same ladder against a frontier model, to
separate what the gate contributes from what the engine does. Cheapest of the four and not done
only because it moves the substrate: neutral checkout directory names and a `node_modules` per
side, so a test cannot tell which checkout it is in without doing behavioural work.

**The hot take.** An LLM's confident output is not evidence of anything, including its own
reliability, and the industry's habit of quoting a single run as a capability number is how a 7/12
agent gets reported as a 12/12 one. That is not a model problem and no better model fixes it. The
fix is structural: make the agent hand its claim to something it does not control, and report what
survives.
