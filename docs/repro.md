# reproducing the results

Everything in `CHANGELOG.md` comes from run directories that are committed to this repo. You can
check most of the work without an API key and without spending anything: the corpus rebuilds
itself from pinned upstream tags, the test suite runs offline, and every measured run's summary,
trajectory and rendered review page comes out of `runs/`.

Re-measuring an arm needs a paid OpenRouter key. Those sections are marked **paid** below and the
per-arm price is in [what a run costs](#what-a-run-costs); the whole k=3 stage-2 flash arm, the
shipped configuration, is about six cents.

| | needs a key | wall time |
|---|---|---|
| `npm run corpus:setup` + `corpus:verify` | no | ~70s (network) |
| `npm test`, `npm run demo` | no | ~3s |
| read the shipped runs (`analyze-k3.mjs`, `gate-audit.mjs`, …) | no | instant |
| render a trajectory or a review package | no | instant |
| one live case | **yes** | ~20s, $0.0005 on flash / $0.0024 on qwen |
| a full k=3 arm | **yes** | 7 min and $0.06 for stage 2 on flash; see [the table](#what-a-run-costs) for the rest |

Everything below was run end to end from a fresh clone into an empty directory on 2026-08-29.
Where a number is from that run it says so; where it is from a measured arm it names the
`CHANGELOG.md` row it belongs to.

## prerequisites

| | version used | notes |
|---|---|---|
| Node | **v22.22.3** | `package.json` requires `>=20`. The corpus manifest records the version it was built with |
| npm | 10.9.8 | only used to invoke scripts and to install inside the corpus checkouts |
| git | 2.43.0 | `corpus/setup.mjs` shallow-clones three repos and `git apply`s the case diffs |
| network | github.com, registry.npmjs.org | corpus setup only |
| OS | Linux x86-64, 2 cores, 4 GB | wall times below are from this box |

**There is nothing to `npm install` at the top level.** This repo has zero dependencies, runtime or
dev; `package-lock.json` holds no packages. `npm install` was never run in the clean clone and
nothing needed it. The only installs that happen are the ones `corpus/setup.mjs` performs inside
`corpus/.work/`, which is gitignored.

```bash
git clone <this repo> silent-mutant
cd silent-mutant
node --version    # expect v20 or newer
```

## the API key

Only the live paths need one: `npm run smoke`, `scripts/tool-call-probe.mjs`, and any
`eval/run-eval.mjs` invocation. Get a key at <https://openrouter.ai/keys> and put credit on it.

`eval/run-eval.mjs` reads `OPENROUTER_API_KEY` from the environment first and falls back to a `.env`
file in the working directory. `.env` and `.env.*` are gitignored.

```bash
printf 'OPENROUTER_API_KEY=sk-or-v1-...\n' > .env
chmod 600 .env
```

Check the key and the remaining balance before starting an arm:

```bash
set -a; . ./.env; set +a
curl -s -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/credits
# {"data":{"total_credits":10,"total_usage":2.687445097}}
```

A run with no usable key fails immediately with
`OPENROUTER_API_KEY is not set (env or .env)` rather than part way through a case.

## the corpus

**Free, no key.** This is the slowest and most breakable step, because it reaches the network and
builds a library from source.

```bash
npm run corpus:setup     # clone 3 pinned tags, install, build js-yaml, assert every pristine suite green
npm run corpus:verify    # apply all 15 case diffs, run each suite, run the differential probe
```

Measured on the clean clone:

| step | wall | what it did |
|---|---|---|
| `corpus:setup` | **49.2s** | ms 16.1s, js-yaml 16.3s (includes `npm run build`), bytes 16.5s |
| `corpus:verify` | **17.9s** | 15/15 verified, 12 buggy and 3 controls |

`corpus/README.md` records 21.7s and 4.8s for the same two steps on the machine the corpus was
built on. The difference is the box, not the work: setup is dominated by three `npm install`s and
verify by the js-yaml cases, which re-run a 314-test suite three times.

Expected tail of `corpus:verify`:

```
PASS  js-yaml-15             buggy    suite green, 4/655 probes diverge on load('a: !!int -0b101') (5.0s)
...
15/15 verified (12 buggy, 3 controls)
```

It exits non-zero on any failure. Pass case ids to check a subset:
`node corpus/verify.mjs js-yaml-15 ms-170`.

### three things worth knowing before you run it

- **`corpus:setup` rewrites `corpus/manifest.json`,** so `git status` shows it modified afterwards.
  That is expected. What matters is which fields changed: on the clean-clone run only
  `generatedAt`, `node` and the three `setupSeconds` moved. The three commit SHAs were byte
  identical, which is the actual check that the tag pins still resolve to the same code.
- **`corpus/.work/` is gitignored and disposable.** `npm run corpus:setup -- --fresh` deletes the
  checkouts and starts over; without it an existing checkout at the pinned SHA is reused. The
  `--fresh` rebuild took 50.4s, within a second of the first build, and landed on the same three
  SHAs again.
- **You do not need Stryker.** `corpus/screen.mjs` is generation tooling and `verify.mjs` never
  calls it. The shipped cases carry their own diffs.

## the offline suite

**Free, no key.** Run the corpus setup first: five `describe` blocks in `eval/` are gated on a real
checkout existing and silently do not register without one.

```bash
npm test        # 57 passing in 3.1s with the corpus present; 49 without it
npm run demo    # offline scripted run against a mock transport, no network at all
```

The gated blocks are the ones that matter most for this project's claims: the double-run gate
against a real checkout, and stage 1, stage 2 and stage 3 driven end to end against scripted model
responses. The stage-3 pair is the byte-for-byte comparison that holds a memory-off run to sending
exactly what the shipped stage sends.

`npm run demo` writes `runs/demo.jsonl` and `demo.html`, exercising all six trajectory event types
including a retry and a checkpoint. It is the fastest way to see what a trajectory page looks like
without a key.

Both of those files are committed, so the demo leaves `git status` dirty, and in two different
ways. `runs/demo.jsonl` is **appended to**, not replaced: after one demo it holds two runs, which
is deliberate and is what the renderer's multi-run keying is exercised against. `demo.html` is
**stale in the repo** — it was committed before the renderer's design pass, so re-rendering it
rewrites most of the file. The page you get from `npm run demo` is the current one; the committed
copy is not. `git checkout demo.html runs/demo.jsonl` puts both back.

## running one case

**Paid**, about 20 seconds, half a cent at most.

The measured configuration is per engine, and the flags are not optional decoration: the provider
pin, the reasoning setting and `--max-tokens` are all part of what was measured. Row 0e in
`CHANGELOG.md` is why the pin exists at all. Change any of them and you are measuring a different
arm than the one the rows report.

Stage 2 (hypothesizer/prover split) on `z-ai/glm-5.3-flash`, which is the shipped configuration on
that engine:

```bash
node eval/run-eval.mjs \
  --candidate stage-2 \
  --model z-ai/glm-5.3-flash \
  --provider "Z.AI" --require-parameters --reasoning low \
  --max-tokens 4096 \
  --cases ms-170 \
  --out runs/try-ms-170
```

What that printed on the clean clone:

```
proved         ms-170                 21.6s  8767 tok  $0.000515

case                    kind      outcome         claim    proof           wall     tokens    cost
----------------------  --------  --------------  -------  --------------  -------  --------  ----------
ms-170                  buggy     proved          defect   red/green 1/0   21.6s    8767      $0.000515

proof rate     1/1 (100%)
false alarms   0/0
misses         0   claims not proved 0   no verdict 0   errors 0
```

`red/green 1/0` is the whole claim: the agent's own test exits 1 on the patched checkout and 0 on
the pristine one, under the library's own runner. `run-eval.mjs` re-runs that pair itself rather
than believing the candidate's gate.

Stage 1 (prover loop) on `qwen/qwen3-30b-a3b-instruct-2507`, the shipped configuration on the other
engine. Two differences, and both matter: no `--reasoning` flag at all, and a full arm on this
engine runs the 12 ms+bytes cases rather than all 15.

```bash
node eval/run-eval.mjs \
  --candidate stage-1 \
  --model qwen/qwen3-30b-a3b-instruct-2507 \
  --provider "CoreWeave" --require-parameters \
  --max-tokens 4096 \
  --cases ms-170 \
  --out runs/try-qwen-ms-170
```

```
proved         ms-170                 23.8s  20111 tok  $0.002391
```

Sending a `reasoning` field on this model is an HTTP 404 from OpenRouter's router: no endpoint for
the instruct build declares the parameter, and `--require-parameters` refuses to route to an
endpoint that does not. Row 0e has the detail. The js-yaml cases are excluded because the frontier
sweep measured this model at 0/58 on them (row 0d).

Note the price difference on the same case: $0.0024 on qwen against $0.0005 on flash. The frontier
engine is roughly five times the cost per case and proves fewer of them; that trade is what rows 0d
through 3 are about.

### the flags

| flag | why it is there |
|---|---|
| `--candidate` | `baseline-1`, `baseline-2`, `stage-1`, `stage-2`, `stage-3` — files in `eval/candidates/` |
| `--provider` + `--require-parameters` | pins routing to one endpoint with no fallbacks, and refuses endpoints that do not declare the request's parameters. A 1/10-to-5/10 spread across endpoints of one model id is bigger than anything the repetitions show (row 0e) |
| `--reasoning low` | flash only. Matches default-reasoning accuracy at a third of the cost |
| `--max-tokens 4096` | pinned from stage 1 onward. Without it three qwen generations ran to the 65,536-token cap at $0.02 and ~10 min each (row 0f) |
| `--concurrency` | cases share nothing, so they run in a pool. Per-case wall times stay honest; only the run total compresses. Stage 3 forces `1` |
| `--option key=value` | candidate knobs, recorded in `summary.json` as `candidateOptions`. Stage 3 uses `base=stage-1|stage-2` and `memory=on|off` |
| `--cases` | case ids, space separated. Omit for all 15 |

## running a full k=3 arm

**Paid.** The primary metric is *cases proved in every one of three repetitions*, so an arm is
three runs of the same candidate and the scripts in `eval/` drive them:

```bash
eval/run-baselines-k3.sh flash|qwen     # both stage-0 baselines, k=3
eval/run-stage1-k3.sh    flash|qwen
eval/run-stage2-k3.sh    flash|qwen
eval/run-stage3-k3.sh    flash|qwen [on|off]
```

Each script hardcodes its engine's pins, case slice and `--max-tokens 4096`, so the engine argument
is the only decision. `REPS` and `CONCURRENCY` override the defaults (3 and 4).

**The scripts skip a repetition whose `summary.json` already exists**, and this repo ships all of
them, so on a fresh clone `eval/run-stage2-k3.sh flash` prints three "already done" lines and
spends nothing:

```
[stage2] runs/stage2-flash-rep1 already done
[stage2] runs/stage2-flash-rep2 already done
[stage2] runs/stage2-flash-rep3 already done
```

That guard is what makes an interrupted arm resumable, and it means re-measuring takes an explicit
step. Either move the committed runs aside, or write your repetitions to a prefix of your own and
point the analysers at it. The second is cleaner, and it is what the numbers below came from:

```bash
for rep in 1 2 3; do
  node eval/run-eval.mjs \
    --candidate stage-2 --model z-ai/glm-5.3-flash \
    --provider "Z.AI" --require-parameters --reasoning low \
    --max-tokens 4096 --concurrency 4 \
    --out "runs/repro-stage2-flash-rep${rep}"
done
node eval/analyze-k3.mjs repro-stage2-
node eval/gate-audit.mjs repro-stage2-
```

`analyze-k3.mjs` takes the run-directory prefix, groups by arm, and prints the per-repetition rates
followed by the primary metric and a per-case outcome matrix. Its marks are
`P` proved, `u` claim-unproved, `.` miss, `C` control correct, `A` false alarm, `?` no-verdict,
`E` error.

### what that arm actually produced

Run on the clean clone on 2026-08-29, three repetitions of stage 2 on flash, the shipped
configuration. This is `node eval/analyze-k3.mjs repro-stage2-` verbatim:

```
## flash  (k=3)
model z-ai/glm-5.3-flash   request {"reasoning":{"effort":"low"},"max_tokens":4096,"provider":{"order":["Z.AI"],"allow_fallbacks":false,"require_parameters":true}}

rep     proof rate  false alarms  claim-unproved  miss  no-verdict  error   tokens    cost       wall
1       12/12       0/3           0               0     0           0       480121    $0.0242    2.7 min
2       12/12       0/3           0               0     0           0       566738    $0.0189    2.5 min
3       12/12       0/3           0               0     0           0       470140    $0.0143    2.0 min

proved in ALL 3 reps   **12/12**
proved in at least one         12/12
cases that flip between reps   0/12
controls false-alarmed at least once  0/3
```

| | row 2 | this re-measurement |
|---|---|---|
| proved in all three | 12/12 | **12/12** |
| false alarms | 0/3 every rep | 0/3 every rep |
| cases that flip | 0 | 0 |
| gate attempts | 45 | **45** |
| cost | $0.0613 | $0.0574 |
| tokens | 1.55M | 1.52M |
| wall (3 reps, `--concurrency 4`) | 7.8 min | 7.2 min |

This is the cleanest arm in the project and it came back identical on the metric. That is not the
general case — see [the noise floor](#the-noise-floor) — and it is worth saying why this one holds:
row 2 closed flash's headroom, so there is no case left that is only sometimes provable.

The gate aggregates matched as well: 45 attempts, 7 runs that revised at least once, 7 proofs that
needed a revision, in both. What moved is which case spent them. In the committed arm `bytes-52`
took four attempts in rep 3 (`1/1 1/1 1/1 1/0`); in the re-measurement
it took four in rep 2 (`1/1 2/2 1/1 1/0`), and rep 3 proved it first try. Same answer, different
route to it — which is the level at which this arm is actually stochastic.

### the other audit tools

All of these read committed runs, so they cost nothing:

```bash
node eval/analyze-k3.mjs  stage2-       # scores, primary metric, per-case matrix
node eval/gate-audit.mjs  stage2-       # every gate attempt's exit-code pair, per case
node eval/ledger-audit.mjs stage2-      # the hypothesis ledger above the gate (stages 2 and 3)
node eval/memory-audit.mjs stage3-      # the notebook and what carrying it cost (stage 3)
node eval/report.mjs runs/stage2-flash-rep1/summary.json   # the one-run table, reprinted
```

## where runs land

Every run writes one directory under `runs/`:

```
runs/stage2-flash-rep1/
  summary.json        the scored result for the whole run
  ms-170.jsonl        one trajectory per case, named by case id
  bytes-12.jsonl
  ...
```

The naming is by convention, not enforced: `--out` decides. The committed directories follow it, so
a prefix identifies an arm and `-rep<n>` its repetition, which is what `analyze-k3.mjs` and the
audit tools group on.

| prefix | what it is |
|---|---|
| `stage0-baseline-*`, `day2-baseline-*` | row 0 single runs; row 0f re-measured at k=3 |
| `stage1-`, `stage2-`, `stage3-` | rows 1, 2, 3. Stage 3 also carries `-on-` / `-off-` |
| `sweep-`, `providercheck-`, `toolprobe-`, `repin-` | rows 0d and 0e, the engine selection work |
| `composite-` | row 0c, the composite-diff spike |
| `smoke-*`, `demo.jsonl` | the scaffold's own runs |

Trajectories are also self-contained records on their own: `src/render-review-package.mjs` renders
one from a bare JSONL and names whichever parts of the record were missing.

## reading a summary.json

The top of the file is the configuration the run actually ran at, recorded rather than asserted.
A run written by the current code, here `runs/stage3-flash-off-rep1/summary.json`:

```json
{
  "candidate": "stage-3",
  "model": "z-ai/glm-5.3-flash",
  "requestExtras": {
    "reasoning": { "effort": "low" },
    "max_tokens": 4096,
    "provider": { "order": ["Z.AI"], "allow_fallbacks": false, "require_parameters": true }
  },
  "candidateOptions": { "base": "stage-2", "memory": "off" },
  "concurrency": 1,
  "order": ["bytes-12", "bytes-15", "..."],
  "wallMs": 546522,
  "totals": { "...": "..." },
  "cases": ["..."]
}
```

`requestExtras` is the exact knob set sent to OpenRouter. Two arms are only comparable if this
block matches; a missing `reasoning` key on a qwen arm is the recorded absence described above, not
an omission.

**The recorded fields grew as the measurement did, so older runs carry fewer of them.** Three
generations are committed: the row-0 runs predate `requestExtras` entirely, which is the gap row 0e
was opened to close; the `day2-`, `stage1-` and `stage2-` runs carry `requestExtras` but not
`candidateOptions`, `concurrency` or `order`, which stage 3 added when case ordering became part of
the measurement. Read a `stage2-` summary expecting `order` and you will not find it.

`totals` is the run's headline:

```json
{
  "cases": 15, "buggy": 12, "controls": 3,
  "proved": 12, "proofRate": 1,
  "claimUnproved": 0, "misses": 0,
  "falseAlarms": 0, "controlsCorrect": 3,
  "noVerdict": 0, "errors": 0,
  "usage": { "promptTokens": 503284, "completionTokens": 9579,
             "totalTokens": 512863, "costUsd": 0.02414361 },
  "wallMsTotal": 550118
}
```

`proofRate` is a single-run rate over the buggy cases. It is not the primary metric; the primary
metric is what `analyze-k3.mjs` computes across three of these. `wallMsTotal` is the sum of the
per-case walls and is larger than `wallMs` whenever concurrency is above 1.

Each entry in `cases` scores one case. The outcome vocabulary, from `eval/score.mjs`:

| outcome | kind | meaning |
|---|---|---|
| `proved` | buggy | the submitted test went red on the mutant and green on pristine |
| `claim-unproved` | buggy | a defect was claimed, but no test was offered or the double run did not hold. Withheld, not shipped |
| `miss` | buggy | the change was called clean. The failure that matters: it tells a maintainer nothing is wrong |
| `correct` | control | an equivalent refactor was called clean |
| `false-alarm` | control | a defect was claimed on an equivalent refactor. Treated as a hard error |
| `no-verdict` | either | no parseable answer |
| `error` | either | the run itself failed |

The `proof` object on a buggy case carries the evidence, and it is what makes the score checkable
by hand: `proof.testFile` is the exact test, `proof.mutant.code` and `proof.pristine.code` are the
two exit codes, `proof.command` is the runner, and both `tail` fields hold the runner output.

```json
"proof": {
  "path": "test/proof-test.js",
  "command": "./node_modules/.bin/mocha test/proof-test.js",
  "testFile": "var assert = require('assert');\nvar bytes = require('..');\n...",
  "mutant":   { "code": 1, "ms": 212, "tail": "AssertionError ... 1024 !== null" },
  "pristine": { "code": 0, "ms": 215, "tail": "1 passing" },
  "proved": true
}
```

## rendering

**Free.** Both renderers read a committed run and write one self-contained HTML file: no external
requests, no script tag, verified by a test in `npm test`.

A trajectory page is the run step by step — what the agent did, how the tools answered, where it
retried, where a checkpoint was witnessed:

```bash
npm run render -- runs/stage2-flash-rep1/ms-170.jsonl -o out/ms-170.html
```

A review package is what a human opens for **one case**: the diff under review, the hypothesis
ledger where the run produced one, every gate attempt with the test submitted and both runners'
output and exit codes, what changed in the test between attempts, and the verdict with the test
that proved it. The corpus's own record of the case, ground truth the agent never saw, is set apart
at the end.

```bash
npm run render:review -- runs/stage2-flash-rep1 ms-170 -o out/ms-170-review.html
# or, defaulting the output next to the trajectory:
npm run render:review -- runs/stage2-flash-rep1 ms-170
```

Four packages are committed in `review/`, chosen to cover the shapes:

| file | what it shows |
|---|---|
| `stage2-flash-rep1-ms-170.html` | a stage-2 proof: a four-entry ranked ledger, two gate attempts, the second red/green |
| `stage1-flash-rep1-js-yaml-18.html` | stage 1 revising with no ledger above it: three gate attempts before one holds |
| `stage2-qwen-rep1-bytes-12.html` | the empty-ledger exit on qwen, a buggy case ended without an attempt |
| `stage1-qwen-rep3-bytes-control-loop.html` | a control claimed as a defect in four attempts, none of which passed, so the proof space prints empty |

Re-rendering any of them from its run directory reproduces the page. Three of the four differ from
the checked-in copy by two CSS declarations inside the `<style>` block, from a stylesheet change
made after they were rendered; the body markup is byte identical.

## what a run costs

Prices below are the ones recorded in the `CHANGELOG.md` rows, not estimates. Every run reports
cost from OpenRouter's own usage fields, which only appear because the loop sends
`usage: { include: true }`, and the table is the sum over each arm's three committed
`summary.json` files rather than a number retyped from the rows.

Per k=3 arm, three repetitions of one candidate on one engine:

| arm | row | cases | cost | tokens | wall |
|---|---|---|---|---|---|
| baseline 1, flash | 0f | 15 | $0.0162 | 0.39M | 1.8 min |
| baseline 2, flash | 0f | 15 | $0.0150 | 0.28M | 7.3 min |
| baseline 1, qwen | 0f | 12 | $0.0671 | 0.26M | 11.4 min |
| baseline 2, qwen | 0f | 12 | $0.1382 | 0.95M | 37.7 min |
| **stage 1, flash** | 1 | 15 | $0.0249 | 0.85M | 3.6 min |
| **stage 1, qwen** (shipped) | 1 | 12 | $0.0709 | 0.55M | 5.2 min |
| **stage 2, flash** (shipped) | 2 | 15 | $0.0613 | 1.55M | 7.8 min |
| stage 2, qwen | 2 | 12 | $0.0407 | 0.36M | 1.1 min |
| stage 3, flash, memory off | 3 | 15 | $0.0721 | 1.66M | 26.3 min |
| stage 3, flash, memory on | 3 | 15 | $0.0816 | 1.75M | 41.0 min |
| stage 3, qwen, memory off | 3 | 12 | $0.0927 | 0.67M | 17.0 min |
| stage 3, qwen, memory on | 3 | 12 | $0.1242 | 1.00M | 16.9 min |

Two things distort the wall column and neither is a property of the candidate. Stages 0 to 2 ran
four cases in parallel and stage 3 runs at `--concurrency 1`, because a candidate carrying a file
between cases has to answer them one at a time. And the four stage-3 arms were measured with all
four running at once on a two-core box, so they compare within an engine pair and not across the
table.

Per stage, including the trial and smoke runs the rows record:

| | cost |
|---|---|
| row 0, both single-run baselines | $0.093 |
| row 0c, composite-diff spike | $0.0457 |
| row 0d, the frontier sweep over 73 cases, 3 models, 2 reps | **$0.92** |
| rows 0e + 0f, engine pins and the k=3 baselines | $0.2482 |
| row 1, stage 1 | $0.1028 |
| row 2, stage 2 | $0.1044 |
| row 3, stage 3 | $0.3773 |

That is about **$1.89** for the whole measured programme, and the frontier sweep in row 0d is half
of it. The twelve k=3 arms in the table above — every number the stage rows are argued from — are
$0.805 together. The rest is engine selection.

Two live checks are cheap enough to be worth naming even though they are paid: `npm run smoke` is
$0.000143 for one three-step run (`docs/dev-notes.md`), and `scripts/tool-call-probe.mjs` cost
$0.0010 for all six endpoint probes in row 0e. Either is a fine way to confirm a key works before
committing to an arm.

## the noise floor

**A proof rate here carries about a case of run-to-run variance, and the primary metric is not
exempt.** Read every number in `CHANGELOG.md` with that in mind.

The clearest evidence is in row 3, where both memory-off arms are re-measurements of an already
shipped candidate with nothing changed but the ordering:

- flash memory-off re-measures stage 2, whose row is **12/12**, and lands **11/12**.
- qwen memory-off re-measures stage 1, whose row is **4/10**, and lands **3/10**.

Same candidate, same pins, same gate budget, same `--max-tokens`. The differences are fresh
sampling, `--concurrency 1` instead of 4, and the fixed sequential case order stage 3 requires.
Both landed one case low. That is why the row 3 ablation is scored against its own off arm rather
than against rows 1 and 2, and it is the honest size of the error bar on a single k=3 number.

Single-run rates move more. Baseline 1 on flash was reported as 12/12 in row 0 and its three
repetitions in row 0f were 11/12, 11/12 and 9/12, for 7/12 held across all three. Baseline 2 on
flash flipped 8 of its 12 cases between repetitions. The k=3 metric exists because of exactly this,
and it reduces the variance rather than removing it.

The stage-2 flash arm re-measured [above](#what-that-arm-actually-produced) came back at 12/12 with
zero flips, and that is not a counterexample. It is the one arm with no headroom left: all twelve
buggy cases proved in all six repetitions now on record, three from row 2 and three from here, so
there is nothing sitting near the boundary for the sampling to move. Expect a re-measurement to
land on the row where the row is at a ceiling, and to move by a case where it is in between — which
is where every arm worth arguing about sits.

What is stable across every arm measured is the false-alarm column: 0 on flash in every repetition
of every stage, and 0 on qwen in every repetition from stage 1 onward. That one is a real hard
zero, and it is the number the corpus's three controls were built to test.
