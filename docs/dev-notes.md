# dev notes

## Model choice

`GET https://openrouter.ai/api/v1/models` on 2026-08-28 lists the current GLM flash id as
**`z-ai/glm-5.3-flash`** (1,310,720 context; $0.075/M prompt, $0.25/M completion). `z-ai/glm-4.7-flash`
is the older flash tier and is cheaper but shorter-context. The smoke run uses `z-ai/glm-5.3-flash`;
override with `SMOKE_MODEL=<id> npm run smoke`.

## Smoke run cost

`runs/smoke-2026-08-28T17-15-15.jsonl`, three steps, four tool calls (the model batched two calls per
step):

- 1,556 tokens total, 1,120 in / 436 out
- **$0.000143** reported by OpenRouter's usage fields
- 22.7s wall

Cost only appears when the request body carries `usage: { include: true }`; the loop passes that
through its `extraBody` option. Without it OpenRouter returns token counts but no cost, and the
renderer shows no cost row.

## Design notes

- The transport is injected, so tests and the demo drive the loop with scripted responses and no
  network. `sleep` is injected for the same reason, which keeps the retry tests instant.
- Tool failures (throwing, unknown tool, denied checkpoint) become tool results fed back to the
  model rather than run errors. Only transport failures that exhaust retries end a run.
- Retries cover 408/409/425/429 and 5xx plus thrown transport errors, with doubling backoff from
  `retryBaseMs`. Every retry is a `retry` event, so a slow run is legible afterwards.
- Checkpoints are attached to tools via `requiresApproval`. The loop consults `onCheckpoint` and
  logs the decision; anything other than `approve` skips the call.
- All renderer colour/space/font values live in one `:root` block, so a design pass can restyle by
  editing that block alone.

## Completion summary (2026-08-28)

Scaffold is done and green:

- `npm test` 14 passing (tool dispatch, unknown/throwing tools, retry backoff and give-up,
  non-retryable status, max-steps stop, checkpoint denial, usage aggregation, request shape,
  trajectory envelope, full-run schema validity, self-contained HTML).
- `npm run demo` writes `runs/demo.jsonl` and `demo.html`, exercising all six event types including
  a retry and a checkpoint.
- `npm run smoke` verified live against `z-ai/glm-5.3-flash`; the agent used both real tools and
  answered correctly (A-1099 returnable at 6 days, A-1042 not at 41 days against a 30-day window).

Open for the next session: README placeholders (user / bottleneck / why it matters), the eval set
and `docs/repro.md` numbers, and the design pass over the renderer's `:root` block.

## Design pass on the trajectory renderer (2026-08-28)

The renderer now emits "The Bound Record": a countersigned laboratory notebook, per the committed
direction. `src/render/stylesheet.mjs` holds the design system's `tokens.css` inlined verbatim
between `BEGIN`/`END` markers plus the document's own rules; regenerate that block from the source
sheet rather than editing it, since the runtime restyles by swapping it alone.

What the markup carries:

- three inks — printed apparatus (condensed small caps), the written record (text serif), and
  instrument output (mono in a tipped-in sheet), so claim and evidence are told apart without labels
- one continuous spine down the chain, with the state of each step struck on it as a shape, never a
  hue: filled square executed, open square retried, ringed square checkpointed, open circle failed.
  A step reaching more than one state takes the least routine mark; the struck retry still hangs
  under the line either way
- every tipped-in sheet carries its event key across the caption rule (`e02`, `e06`), keyed by the
  event's position in the file rather than its `seq`, so the key still points at one line when a
  file holds more than one run

Two contracts the renderer may not bend: a witness or approval line renders only from a recorded
`checkpoint` event, and with none the rule prints over an empty space labelled unwitnessed; what
crosses a join is the event key, never initials.

Verified by rendering `runs/demo.jsonl` (all six event types, two runs concatenated) and the smoke
run, reading both outputs, and screenshotting at 1280 and 420 in light and dark. `npm test` stays
at 14 passing, including the self-contained-HTML check: no external requests, no script. Two fixes
diverge from the comp, where its CSS is wrong: the narrow-width separator between the chain's time
and step keys is selected across the hidden `<br>` (a span-plus-span selector never matches there),
and the foot attestation drops its own top rule when it follows a heading that already prints one.
## Corpus completion (2026-08-28)

`npm run corpus:setup` + `npm run corpus:verify` are green end to end from a fresh clone: 12 buggy
cases and 3 controls, 15/15 verified.

Wall times on this machine (Node v22.22.2):

| step | time |
|---|---|
| `corpus:setup --fresh` (3 clones, installs, js-yaml build, 3 pristine suites) | 21.7s |
| `corpus:verify` (15 cases: apply, suite, probe) | 4.8s |
| `corpus/screen.mjs ms` (stryker 9.1s + screen of 38 survivors) | 15.5s |
| `corpus/screen.mjs bytes` (stryker 7.7s + screen of 14 survivors) | 14s |

Survivor-pool differences from the spike:

- **ms is identical on mutation counts** — 177 mutants, 139 killed, 38 survived — but **35 of 38 are
  discriminable here against the spike's 32**. Same survivors, wider probe corpus: 1071 inputs
  sweeping every unit spelling against both output formats and both sides of every unit and plural
  threshold, against the spike's ~150. The three extra are the input-type guard, the emptied error
  message and the disabled 100-character cap, all of which need probe inputs the narrower corpus
  never sent.
- **bytes.js spiked green**, which the spike had not measured: 146 mutants, 132 killed, 14 survived,
  6 discriminable (43%). It supplies 3 cases, so no backfill from ms was needed.
- **js-yaml was not re-run.** The region takes 8.7 minutes and yields 2 discriminable survivors; both
  are in the corpus, reproduced from the spike's recorded mutation location and replacement and
  re-verified end to end.

Two things cost real time and are worth knowing before touching this again:

- **Node's module cache is keyed by filename for CommonJS.** `verify.mjs` probes the same checkout
  path once per case with different content each time, and a `?query` cache-buster does not help for
  ms and bytes because the ESM import is routed through the CJS require cache. Ten of fifteen cases
  passed for the wrong reason until the probe started snapshotting the mutant to a fresh path. The
  three js-yaml cases were unaffected, which is exactly what made the failure legible.
- **The probe must resolve js-yaml schemas from the module it is calling.** Capturing pristine's
  `CORE_SCHEMA` and handing it to the mutant routes resolution through pristine tag definitions and
  hides every mutation in the region under test.

The hard case is `js-yaml-15` per the report: one character inside the explicit-integer pattern
(`[-+]?0b` to `[^-+]?0b`), 314 tests green, reachable only through an explicit `!!int` tag carrying a
signed non-decimal literal.

## Stage 0 completion (2026-08-28)

Both baselines ran over all 15 cases on `z-ai/glm-5.3-flash`. Rows are in CHANGELOG.md; the runs
are `runs/stage0-baseline-1-2026-08-28T18-56-11/` and `runs/stage0-baseline-2-2026-08-28T18-56-15/`,
each holding one trajectory per case plus `summary.json`.

| run | proof rate | false alarms | tokens | cost | wall |
|---|---|---|---|---|---|
| baseline 1 (one prompt, no tools) | 12/12 | 0/3 | 212,375 | $0.0478 | 6.4 min |
| baseline 2 (read-file + run-command) | 9/12 | 0/3 | 466,005 | $0.0358 | 13.8 min |

Total spend for the session, including two two-case trial runs: **$0.093**. Both runs used
`--concurrency 4`; per-case wall times in the summaries are real, only the run totals are
compressed. Median per-case wall was 72s for baseline 1 and 97s for baseline 2.

### The finding that matters: baseline 1 saturates the corpus

A single prompt with the changed file and the diff, no execution at all, proves every one of the 12
buggy cases and stays silent on all 3 controls. That includes `js-yaml-15`, the designated hard
case, which it catches with `load('!!int "-0b1010"')`.

The corpus was built to be hard for the *library's own test suite*, and it is: every mutant is
silent under 49 / 314 / 30 existing tests. It was never screened for being hard for a reviewer who
is handed the diff, and the diff points straight at the mutated span. On this corpus and this model
there is no proof-rate headroom above stage 0. Stages 1 to 3 can still be measured on cost, wall
time, and baseline 2's failure modes, but "the gate raises the proof rate" is not a claim this
corpus can support. Deciding what to do about that is a call for the next session; the honest
sequence was the point of running stage 0 first, and this is what it bought.

### Baseline 2's three failures are the interesting half

- `js-yaml-15`, `js-yaml-18` — both hit `maxSteps: 12` and returned no final text at all. They
  spent the budget reading a 129 KB bundle in 8 KB tool-result slices and re-deriving how js-yaml
  resolves its own package name. Baseline 1, handed the same file whole, answered in one turn.
- `ms-72` — claimed the defect correctly and shipped a test with a true first assertion and a false
  second one: `ms(ms('1y'))` is `'365d'`, not `'1y'`, on pristine too. Red on both sides, so not a
  proof. This is exactly the failure the stage-1 double-run gate is meant to catch before the
  answer leaves the agent.

Tool access cost 2.2x the tokens and 2.2x the wall time for a lower score. Cost per run is still
lower than baseline 1 because baseline 1's completions are long reasoning traces on expensive
output tokens, while baseline 2's tokens are mostly cheap prompt tokens re-sent each step.

### Notes for whoever touches `eval/` next

- **Checkouts are copied, never mutated in place.** `eval/workspace.mjs` copies
  `corpus/.work/<lib>` twice into a temp dir minus `node_modules` (symlinked back), resets each
  copy's entry module from the pristine snapshot, and applies `mutation.diff` to one. Resetting
  from the snapshot rather than trusting the shared checkout means a crashed run cannot leak a
  mutation into the next case. A pair costs 11-51 ms to prepare.
- **The module-cache gotcha from the corpus section does not apply here.** Every proof run is a
  fresh `node`/`mocha` process against its own directory, so pristine and mutant are never in one
  process. That is the reason the double run is two spawns rather than two imports.
- **Where a proof test lands** is per library, in `PROOF_RUNNERS`: `proof-test.js` for ms,
  `test/proof-test.js` for bytes, `test/core/proof.test.mjs` for js-yaml. Each is a path the
  library's own runner already covers, and each candidate is shown the exact skeleton, so the
  import path is never something the model has to guess.
- **`run-command` confines the cwd, not writes.** Baseline 2 wrote a scratch script to `/tmp` with
  a shell redirect and ran it from inside a checkout. That is within the ticket's contract (reject
  any cwd outside the checkouts) and it is worth knowing before this is pointed at anything less
  disposable than a temp checkout.

## Config repin: provider + reasoning made explicit and recorded (2026-08-28, late)

Prompted by the stage-0 review: no run so far sent a `reasoning` field or pinned a provider, and
nothing recorded which provider served a request or whether it spent reasoning tokens. Changes on
this branch: the loop records `provider` and `reasoningTokens` per step and aggregates both into
`run-end`; `run-start` carries `requestExtras` (the exact knobs sent); `eval:run` grew
`--reasoning <off|effort>` and `--provider <name>` (pin with `allow_fallbacks: false`), both echoed
into `summary.json`.

Replication of stage-0 baseline-1, 15 cases each arm, measured:

| arm | config | proof rate | notes |
|---|---|---|---|
| stage 0 (original) | unpinned, default | 12/12 | single run, config unrecorded |
| A | unpinned, default, now recorded | 11/12 | served by EIGHT providers (Z.AI x6, DeepInfra x2, Novita x2, Makora, Modal, Parasail, Reka, Wafer); every request emitted reasoning tokens (7-9,382); js-yaml-15 no-verdict |
| B | Z.AI pinned, `reasoning {enabled:false}` | error | HTTP 400 "Reasoning is mandatory for this endpoint and cannot be disabled" on all 15 — flash has no reasoning off switch |
| B2 | Z.AI pinned, default reasoning | 10/12 | 64,803 reasoning tokens total; ms-170 and ms-27 claim-unproved |
| C | Z.AI pinned, `effort: low` | 11/12 | 1,202 reasoning tokens total, $0.010 vs B2's $0.027; js-yaml-15 claim-unproved |

Reading: the "12/12 saturation" was one draw from a distribution whose observed range across four
runs is 10-12/12, with failures concentrated in js-yaml-15 and scattered ms cases, and effort-low
matches default accuracy at a third of the cost. The corpus is near-ceiling but not flat: the
honest headroom is reliability across repetitions, not single-run proof rate. Canonical config from
here: provider pinned, reasoning effort explicit, both recorded in every trajectory.

## Engine pair settled, and stage-0 baselines re-measured at k=3 (2026-08-29)

Day-2 step 2. Two questions: can `qwen/qwen3-30b-a3b-instruct-2507` drive a tool loop at all (it
has to, for the prover stages), and what do the canonical baselines look like when every run is
pinned and repeated three times instead of once.

### Tool calling: verified, on every provider that declares it

`scripts/tool-call-probe.mjs` drives the real agent loop — the same `runAgent` the stages use —
once per provider, pinned with `provider: { order: [name], allow_fallbacks: false,
require_parameters: true }`, on a two-step scenario (look an order up, then ask a policy tool about
its age) where the answer is only reachable through the tools.

| provider | tool calls | arguments parsed | stop | answer correct | tokens | cost |
|---|---|---|---|---|---|---|
| StreamLake | 4 | yes | final | yes | 1,380 | $0.000090 |
| SiliconFlow | 4 | yes | final | yes | 1,438 | $0.000164 |
| CoreWeave | 4 | yes | final | yes | 1,416 | $0.000175 |
| Nebius | 4 | yes | final | yes | 1,416 | $0.000175 |
| Alibaba | 4 | yes | final | yes | 1,414 | $0.000247 |

All five endpoints that declare `tools` for this model emit well-formed calls and finish the loop
correctly, so **the engine pair is qwen (frontier) + flash (saturated control)**, as the sweep
recommended. The Luna effort-dial fallback from the model shortlist is not needed and was not run.
`z-ai/glm-5.3-flash` on Z.AI at `effort: low` was probed the same way and is also clean (4 calls,
correct answer, 1,346 tokens).

### Two config facts that fell out of the probe

- **`--require-parameters` is now a flag on `eval:run`** (`provider.require_parameters: true`), so a
  tool-using arm cannot be routed to an endpoint that does not declare tools.
- **The instruct build cannot carry an explicit `reasoning` field under it.** No endpoint for
  `qwen3-30b-a3b-instruct-2507` declares the `reasoning` parameter, so `require_parameters` plus any
  `reasoning` value is HTTP 404 "No endpoints found that can handle the requested parameters" from
  the router. Without `require_parameters` the field is accepted and silently ignored
  (`reasoning_tokens: 0` measured on both `{enabled:false}` and `{effort:'low'}`). The qwen arms
  therefore send no `reasoning` field, which is recorded in every `summary.json` by its absence
  from `requestExtras`; the flash arms keep `effort: low`.

### The provider is a bigger lever than the repetition

Same model id, same 12 ms+bytes cases, one repetition each, provider pinned:

| provider | quantisation | proof rate | notes |
|---|---|---|---|
| CoreWeave | bf16 | **5/10** (three times) | the pin chosen for the qwen arms |
| SiliconFlow | fp8 | 4/10 | 2/2 false alarms |
| Nebius | fp8 | 3/10 | 3 no-verdicts, 1/2 false alarms |
| Alibaba | unknown | 1/10 | 9 claims unproved |
| StreamLake | unknown | — | 12/12 HTTP 429, "temporarily rate-limited upstream", after 4 retries each |

A 1/10-to-5/10 spread across endpoints of one model id is larger than anything the repetitions
show, and StreamLake — the cheapest endpoint and the one an unpinned request is most likely to
land on — was unusable at `--concurrency 4`. This is the concrete reason the pin exists.

### The k=3 baselines

`eval/run-baselines-k3.sh <flash|qwen>` runs both candidates three times at the pinned config;
`node eval/analyze-k3.mjs` prints the tables below from the run summaries. Flash arms are all 15
cases; qwen arms are the 12 ms+bytes cases only, per the sweep's measured 0/58 on js-yaml.

Primary metric, per the day-2 decision: **cases proved in every repetition**, with false alarms
still hard-zero. Single-run rates are alongside, and they are the thing that turns out to move.

| arm | model, config | single-run proof rates | proved in ALL 3 | false alarms | cost (3 reps) |
|---|---|---|---|---|---|
| baseline 1, flash | `z-ai/glm-5.3-flash`, Z.AI, effort low | 11/12, 11/12, 9/12 | **7/12** | 0/3 every rep | $0.0162 |
| baseline 2, flash | same | 5/12, 7/12, 11/12 | **3/12** | 0/3 every rep | $0.0150 |
| baseline 1, qwen | `qwen3-30b-a3b-instruct-2507`, CoreWeave | 5/10, 5/10, 5/10 | **5/10** | 2/2, 2/2, 0/2 | $0.0671 |
| baseline 2, qwen | same | 4/10, 5/10, 2/10 | **2/10** | 0/2, 1/2, 1/2 | $0.1382 |

What the third repetition bought:

- **Baseline 1 on flash is 7/12, not 12/12.** Five of the twelve buggy cases (`bytes-52`,
  `js-yaml-15`, `js-yaml-18`, `ms-12`, `ms-30`) fail at least one repetition. Every case proves at
  least once, so nothing here is stably hard — but nothing above 7/12 is stably solved either.
  That is the headroom the gate has to close, and it is a real number rather than a coin flip
  reported as a ceiling.
- **Baseline 2 on flash is worse and much noisier: 3/12 in all three, 8 of 12 cases flipping.**
  Repetition 1 spent 3.7 minutes and returned two no-verdicts; repetition 3 scored 11/12 in 1.7
  minutes. Tools without a verification contract are the least reliable configuration measured so
  far, which is the failure mode stage 1 exists to fix.
- **Qwen's baseline 1 is flat at 5/10 across all three repetitions** — the same five cases every
  time (`bytes-15`, `ms-4`, `ms-70`, `ms-72`, `ms-170`), the same five failing. On this 12-case
  slice it is stable; the 10-case instability band in the sweep was over the wider 41-case pool.
  Zero misses in all three, matching the sweep.
- **Qwen with tools acquires misses.** Baseline 2 misses one case per repetition (`ms-170` twice,
  `bytes-12` once) — it calls a defective change clean, which baseline 1 never did. It also drops
  to 2/10 in repetition 3. Tools make this model worse in exactly the way they make flash worse,
  only from a lower start.
- **The always-true verdict bit holds.** Qwen false-alarms on both controls in baseline-1
  repetitions 1 and 2; repetition 3's 0/2 is not a correct answer, it is two runaway generations
  (below) that never produced a verdict at all.

### The runaway generation, and what stage 1 should do about it

Three of twelve cases in qwen baseline-1 repetition 3 (`ms-30` and both controls) degenerated into
a repetition loop, ran to the 65,536-token completion cap (`finish_reason: length`), and returned
an unterminated JSON string. Each cost about $0.020 and 9-11 minutes of wall time, against $0.0002
and 3 seconds for a normal case: that one repetition cost $0.062 against $0.0027 for its twins.
The same shape appears in qwen baseline 2 (`ms-control-lookup` in repetition 1 came back as HTTP
400 "Unterminated string", the provider's version of the same failure).

The harness sends no `max_tokens`. A cap around 4,096 would turn a runaway into a fast no-verdict
instead of a ten-minute $0.02 one, and it is a request knob, not a code change to the loop. It is
deliberately **not** applied to the numbers above, because that would change the config the
baselines were measured at; it is the first thing to set when stage 1's config is pinned.

### Spend

$0.2482 for the whole of step 2: $0.2365 for the twelve k=3 runs, $0.0107 for the three usable
provider checks, $0.0010 for the tool-call probes. 1.95M tokens. The qwen baseline-2 arm is 56% of
that, and the three runaway generations are $0.06 of it.

## Stage 1: the prover loop with a double-run gate (2026-08-29)

`eval/candidates/stage-1.mjs`, measured with `eval/run-stage1-k3.sh <flash|qwen>` at the same
pinned configs, case sets and k=3 as the stage-0 baselines. `node eval/analyze-k3.mjs stage1-`
prints the tables; `node eval/gate-audit.mjs stage1-` prints what the gate did underneath them.

The candidate is baseline 1 plus one thing baseline 1 did not have. It gets the same information —
the changed file and the diff, no read or run tools — and one tool it does not control,
`submit-proof`. The harness writes the submitted test into both checkouts at the library's own
proof location, runs the library's own runner in each, and reads the two exit codes. Red on the
changed checkout and green on the original passes. Anything else fails and comes back with both
runners' output plus a line naming the shape of the failure (green on both, red on both,
backwards), up to four attempts — one submission and three revisions.

The gate, not the model's prose, produces the answer:

- a passed gate is answered as a defect, carrying the exact test that passed
- `defect: false` stands as the model wrote it, when no gate attempt ever passed
- a defect claim that never passed the gate is withheld, and the run scores `no-verdict`

`run-eval.mjs` then re-runs the double run itself to score the answer. Both call the same
`doubleRun` in `eval/workspace.mjs`; the scorer never takes a candidate's word for its own gate.

### The numbers

| arm | single-run proof rates | proved in ALL 3 | false alarms | claim-unproved | cost (3 reps) | wall |
|---|---|---|---|---|---|---|
| baseline 1, flash | 11/12, 11/12, 9/12 | 7/12 | 0/3 every rep | 1, 1, 3 | $0.0162 | 1.8 min |
| **stage 1, flash** | 11/12, 12/12, 11/12 | **10/12** | 0/3 every rep | 0, 0, 0 | $0.0249 | 3.6 min |
| baseline 1, qwen | 5/10, 5/10, 5/10 | 5/10 | 2/2, 2/2, 0/2 | 5, 5, 4 | $0.0671 | 11.4 min |
| **stage 1, qwen** | 5/10, 6/10, 5/10 | **4/10** | 0/2 every rep | 0, 0, 0 | $0.0709 | 5.2 min |

Flash gained three cases on the primary metric. Qwen lost one and gave up every false alarm it had.
Neither engine produced a single unproved claim in any of the 81 runs. That is close to free: the
only way one can occur now is if the scorer's independent re-run disagrees with the gate, and it
never did.

### What the gate changed, case by case, on flash

The five cases that flipped under baseline 1 were `bytes-52`, `js-yaml-15`, `js-yaml-18`, `ms-12`
and `ms-30`. Four of them are now proved in all three repetitions. From `gate-audit.mjs`, the
exit-code pairs per attempt:

- **`bytes-52`** — P P P. Rep 1 passed first try. Rep 2 submitted a test green on both, then passed.
  Rep 3 took three attempts: red on both twice, then red/green. Two of the three repetitions needed
  a revision the baseline had no way to ask for.
- **`js-yaml-18`** — P P P. Rep 1 needed three attempts (green on both, green on both, then
  red/green), rep 2 two, rep 3 one.
- **`ms-12`** — P P P. Rep 2 submitted a test red on both and fixed it on the second attempt.
- **`js-yaml-15`** — P P P, one attempt each time. The case the plan designated as hard never
  needed the gate on this engine; its baseline flip was a bad draw, not a hard case.
- **`ms-30`** — P P ?. Still not stable. Rep 3 spent all four attempts on tests that were red on
  both checkouts and was withheld. The failure changed shape rather than disappearing: under the
  baseline it shipped as an unproved claim, here it ships as nothing.

One case moved the other way. **`ms-170`** was stable under baseline 1 and misses in stage 1's
rep 1, where the model answered `defect: false` without submitting anything. That is a real cost of
the arm, not noise in the gate: the gate can only reject a test, it cannot make the model look.

Flash submitted 48 gate attempts across the three repetitions. Eight runs revised at least once and
seven of those revisions ended in a proof. Seven of the arm's 34 proofs exist only because the gate
rejected a first answer.

### Qwen's always-true verdict bit: intact, and now harmless

The bit survives. Qwen submitted a test on both controls in all three repetitions — 24 of its 103
gate attempts were spent trying to prove a defect in an equivalent refactor. What changed is that
none of them got through. Every one of the 24 came back green on both or red on both, and in five
of the six control runs the model then answered `defect: false` (scored `correct`); in the sixth it
used all four attempts and was withheld. False alarms went from 2/2, 2/2, 0/2 to 0/2, 0/2, 0/2, and
the 0/2 in the baseline's third repetition was two runaway generations, not an answer.

So the gate does not fix the model's judgment, it stops the judgment from reaching the output. That
distinction matters for stage 2: a hypothesizer that still believes every change is a defect will
still burn four gate attempts per control.

The cost of that on the buggy half is visible. Baseline 1 qwen claimed a defect on all ten buggy
cases and proved five, with zero misses; stage 1 proves four in all three repetitions and acquires
misses (3, 1, 2 per rep) and no-verdicts (2, 3, 4). `bytes-15` is the case it lost — proved in all
three baseline repetitions, and in stage 1 it goes withheld, proved, miss. `ms-12` and `bytes-12`
are cases it gained in some repetitions. The pattern is the same one the false alarms show: forced
to prove itself, this model backs off things it used to assert, correct ones included.

### The completion cap fired, and needed a harness fix to be useful

`--max-tokens 4096` is pinned in `eval/run-stage1-k3.sh` and recorded in every `summary.json`'s
`requestExtras`. It fired nine times across qwen's three repetitions, each at exactly 4,096
completion tokens: `ms-30` in all three repetitions (twice in rep 1 and rep 3), `bytes-12`,
`ms-control-lookup` twice, `bytes-control-loop`. It never fired on flash.

The cap works on cost and wall time. Qwen's baseline repetitions ran $0.0027, $0.0028 and $0.0616,
that last one 10.9 minutes with three generations at the provider's 65,536-token default. Stage 1's
three repetitions ran $0.0256, $0.0240, $0.0213 at 1.7-1.8 minutes each. The runaway is gone as a
cost event.

It needed one change to the loop to be useful, made in `src/agent-loop.mjs`. A capped generation
cuts a tool call off mid-argument. The truncated call was echoed back into the conversation
verbatim, and CoreWeave rejected the next request with an HTTP 400 on the unterminated JSON, which
ended the run as an `error` rather than a no-verdict. Now unparseable arguments never reach the
tool, the model is told its call was cut off, and the history carries `{}` in place of the broken
string. All nine truncations recovered into a normal turn.

Worth knowing for anything that reads `finish_reason`: all nine came back as `tool_calls`, not
`length`. On this endpoint the only reliable truncation signal was the arguments failing to parse.

### Decision

Keep the gate. On flash it moves the primary metric 7/12 → 10/12 at 1.5x the cost. On qwen it costs
one case on the primary metric and buys the false-alarm rate outright, which is the metric the plan
treats as hard-zero. Neither arm can emit an unproved claim any more.

Stage 2 has a specific target from this. `ms-30` on flash (rep 3) and `ms-27` on qwen (all three
repetitions) spent all four attempts on tests that were red on both checkouts: the model asserts
behaviour the library never had, is told exactly that, and asserts it again. `ms-30` and `bytes-52`
on qwen are the same shape with some green-on-both mixed in. That is a hypothesis problem, not a
verification problem, which is what the hypothesizer/prover split is for.

### Spend

$0.1028 for stage 1: $0.0958 for the six k=3 runs ($0.0249 flash, $0.0709 qwen) and $0.0070 for the
two live smoke runs that pinned the config. 1.50M tokens.
