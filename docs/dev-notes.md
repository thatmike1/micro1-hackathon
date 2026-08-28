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
