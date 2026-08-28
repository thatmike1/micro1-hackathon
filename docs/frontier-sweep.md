# frontier sweep — where does baseline 1 actually break?

**On this task, baseline 1 on `z-ai/glm-5.3-flash` does not break.** Over a pool five times the
size of the corpus — every discriminable survivor across all three libraries, 70 buggy cases and 3
controls — one prompt with no execution proves **69/70** and **68/70** on two repetitions, with
**0/3 false alarms** both times. The corpus was not hiding the model's weaknesses; there are none
at this task on this tier.

The frontier is one tier down. `qwen/qwen3-30b-a3b-instruct-2507` scores **25/70 and 27/70**, and
on the ms+bytes half — the part it is capable of at all — **25/41 and 27/41 with 10 of 41 cases
flipping between repetitions**. That is the regime the architecture study needs: competent enough
to be worth improving, unreliable enough that a verification gate has something to catch.

## The pool

The corpus is 12 buggy cases hand-picked for shape out of a larger measured pool. The sweep drops
the hand-pick and takes the whole pool: every SURVIVED Stryker mutant the differential probe
discriminates.

| library | mutants | survived | discriminable | in `corpus/cases/` |
|---|---|---|---|---|
| ms 2.1.3 | 177 | 38 | 35 | 7 |
| bytes 3.1.2 | 146 | 14 | 6 | 3 |
| js-yaml 5.4.1, `dist/js-yaml.mjs:240-600` | 873 | 125 (+4 timeout) | 29 | 2 |

**70 buggy cases plus the corpus's 3 controls, 73 in all, 73/73 verified** by `corpus/verify.mjs`
unchanged: the diff applies, the library's own full suite is green on the mutant, and the probe's
first divergence is the recorded input.

The js-yaml row is a correction worth carrying back. `corpus/README.md` records 2 discriminable
survivors out of 125, measured in the spike with a narrower probe corpus. Against the probe corpus
that actually shipped — every scalar tag against all five schemas plus `dump` options — **29 of the
same 125 discriminate**. Nothing about js-yaml changed; the screen improved and was never re-run.

Shapes in the pool, by Stryker mutator:

| shape | ms | bytes | js-yaml |
|---|---|---|---|
| StringLiteral | 19 | — | 4 |
| Regex | 9 | 5 | 13 |
| ConditionalExpression | 3 | 1 | 7 |
| ArithmeticOperator | 2 | — | — |
| BlockStatement | 1 | — | 2 |
| EqualityOperator | 1 | — | 1 |
| LogicalOperator | — | — | 2 |

## Method

Everything runs through `sweep/.harness/`, a copy of `src/`, `corpus/` and `eval/` whose
`corpus/cases` symlink points at `sweep/cases/`. The candidate, the prompt, the verdict contract
and the scoring are the stage-0 code unchanged, and `corpus/cases/` is never written to. Scoring is
stage 0's: a claimed defect counts only when the candidate's own test, dropped into the library's
own test location, goes red on the mutant and green on pristine under the library's own runner.

| model | tier | context | price (in / out per M) |
|---|---|---|---|
| `z-ai/glm-5.3-flash` | the stage-0 model | 1,310,720 | $0.075 / $0.250 |
| `qwen/qwen3-30b-a3b-instruct-2507` | 30B MoE, 3B active, non-reasoning instruct | 262,144 | $0.048 / $0.193 |
| `mistralai/mistral-small-3.2-24b-instruct` | 24B dense, non-reasoning instruct | 131,072 | $0.075 / $0.200 |

Prices are from the live OpenRouter `/models` list on 2026-08-28. The model axis here is
**robustness, not economics**: flash is not the expensive rung. Per Artificial Analysis figures
supplied during the run, flash's cost per task is below mistral-small's and near qwen's, so nothing
in this document supports a "cheap model plus architecture beats an expensive one" story.

## Results, diff arm

Baseline 1 unchanged, all 73 cases, two repetitions, `--concurrency 8`.

| model | rep | proof rate | false alarms | no-verdict | errors | tokens | cost | wall |
|---|---|---|---|---|---|---|---|---|
| `z-ai/glm-5.3-flash` | 1 | **69/70 (99%)** | 0/3 | 0 | 0 | 1,558,383 | $0.2585 | 18.0 min |
| `z-ai/glm-5.3-flash` | 2 | **68/70 (97%)** | 0/3 | 1 | 0 | 1,556,944 | $0.2264 | 19.2 min |
| `qwen/qwen3-30b-a3b-instruct-2507` | 1 | 25/70 (36%) | 3/3 | 3 | 0 | 1,170,338 | $0.0777 | 0.9 min |
| `qwen/qwen3-30b-a3b-instruct-2507` | 2 | 27/70 (39%) | 3/3 | 2 | 0 | 1,170,941 | $0.1069 | 1.1 min |
| `mistralai/mistral-small-3.2-24b-instruct` | 1 | 13/70 (19%) | 1/3 | 0 | 1 | 1,213,534 | $0.0922 | 1.8 min |
| `mistralai/mistral-small-3.2-24b-instruct` | 2 | 11/70 (16%) | 1/3 | 1 | 10 | 878,416 | $0.0705 | 8.0 min |

By library, both repetitions pooled:

| library | glm-5.3-flash | qwen3-30b-a3b | mistral-small-3.2 |
|---|---|---|---|
| ms | 69/70 | 50/70 | 23/70 |
| bytes | 11/12 | 2/12 | 1/12 |
| js-yaml | 57/58 | 0/58 | 0/58 |

By mutation shape, both repetitions pooled:

| shape | glm-5.3-flash | qwen3-30b-a3b | mistral-small-3.2 |
|---|---|---|---|
| StringLiteral | 44/46 | 33/46 | 19/46 |
| Regex | 53/54 | 11/54 | 1/54 |
| ConditionalExpression | 22/22 | 3/22 | 2/22 |
| ArithmeticOperator | 4/4 | 4/4 | 2/4 |
| BlockStatement | 6/6 | 0/6 | 0/6 |
| EqualityOperator | 4/4 | 1/4 | 0/4 |
| LogicalOperator | 4/4 | 0/4 | 0/4 |

The per-case matrix is in `sweep/analyze.mjs` output; run `node sweep/analyze.mjs` to regenerate it
from the committed `runs/sweep-*/summary.json` files.

### Two disclosure lines

- **`mistralai/mistral-small-3.2-24b-instruct` is dominated by qwen on every axis measured here**
  (11-13/70 against 25-27/70, plus the run errors below) and is excluded from the analysis that
  follows. Its raw data is committed; nothing is truncated.
- **Both small models score 0/58 on js-yaml.** That is incapacity, not signal: the prompt carries
  a 129 KB bundle, and neither model produced a single test that went red on the mutant and green
  on pristine. Those arms are reported above and then set aside.

The 10 errors in mistral-small rep 2 were upstream HTTP 429s — `mistralai/mistral-small-3.2-24b-instruct
is temporarily rate-limited upstream`, provider DeepInfra, after 4 retries each. They are an
artifact of running at `--concurrency 8`, not model behaviour, and they do not change that run's
result: of the 19 js-yaml cases that did answer, none proved.

## The frontier: qwen3-30b-a3b on ms+bytes

Restricted to the 41 buggy ms+bytes cases and 2 controls it can actually engage with:

| rep | proved | claim-unproved | miss | false alarms | no-verdict |
|---|---|---|---|---|---|
| 1 | 25/41 | 15 | 0 | 3/3 | 1 |
| 2 | 27/41 | 14 | 0 | 3/3 | 0 |

Three properties make this the tier the architecture study wants.

**Its failures are near-misses, not blind misses.** Zero misses in either repetition: it never
calls a defective change clean. Every failure is a defect claimed with a test that does not
discriminate. Over the 29 `claim-unproved` cases in the two ms+bytes runs, the double run splits:

| what the double run found | count |
|---|---|
| red on both builds (test wrong, or does not run) | 16 |
| green on both builds (test does not reach the defect) | 10 |
| green on mutant, red on pristine (asserts the mutant's behaviour) | 3 |

It usually names the right span in its note and then writes a test that misses it — `bytes-13`'s
note correctly says the end-of-string anchor was removed, and the test still fails on both builds.

**Its verdict bit carries no information; only its test does.** It answered `defect: true` on
**every case in both runs**, controls included, which is why false alarms are 3/3 both times. On
`bytes-control-loop` its own note says the change "does not alter observable behavior" while the
JSON says `defect: true`. Any candidate built on this model has to derive the answer from the
double run, not from the model's claim — which is exactly what the stage-1 verification gate does.

**It is unstable across repetitions.** 10 of 41 ms+bytes cases flip:

| case | rep 1 | rep 2 |
|---|---|---|
| `bytes-12` | claim-unproved | proved |
| `bytes-15` | proved | claim-unproved |
| `ms-12` | proved | claim-unproved |
| `ms-45` | claim-unproved | proved |
| `ms-46` | claim-unproved | proved |
| `ms-54` | no-verdict | proved |
| `ms-67` | claim-unproved | proved |
| `ms-90` | proved | claim-unproved |
| `ms-99` | claim-unproved | proved |
| `ms-170` | proved | claim-unproved |

A candidate that moves this model from 26/41 to, say, 33/41 is measuring something real, and the
n=2 noise floor of roughly ±2 cases is now known rather than assumed.

### Flash is not perfectly stable either

Flash dropped one case per repetition, and not the same one: `bytes-8` (`claim-unproved` rep 1,
proved rep 2), `ms-107` (proved rep 1, `claim-unproved` rep 2), `js-yaml-223` (proved rep 1,
`no-verdict` rep 2). Three one-off flips out of 70, no stably hard case. Its 99% is a 99% with a
per-run coin flip in it, which is worth stating whenever the 12/12 stage-0 number is quoted.

## Results, no-diff arm

Baseline 1 with the diff removed and the file introduced as "a recent change may have introduced a
defect" (`sweep/candidates/baseline-1-nodiff.mjs`), flash only, two repetitions, on 10 buggy cases
spanning all three libraries and six shapes, plus the 3 controls.

| rep | proved | claim-unproved | miss | no-verdict | false alarms | tokens | cost | wall |
|---|---|---|---|---|---|---|---|---|
| 1 | **8/10** | 0 | 1 (`ms-91`) | 2 (`js-yaml-15`, `js-yaml-control-hoist`) | 1/3 (`bytes-control-loop`) | 341,677 | $0.0912 | 11.0 min |
| 2 | **5/10** | 2 (`ms-4`, `ms-12`) | 1 (`ms-91`) | 3 (`js-yaml-15`, `js-yaml-18`, `js-yaml-control-hoist`) | 0/3 | 307,302 | $0.0728 | 19.6 min |

**Removing the diff costs flash little on ms and bytes, and costs it a lot of stability.** All
three bytes cases proved in both repetitions, and `ms-72` and `ms-170` did too. The pointer is not
what was doing the work on those; the semantics were.

But the arm is far noisier than the diff arm: four of the thirteen cases flip between repetitions
(`ms-4` and `ms-12` proved then unproved, `js-yaml-18` proved then no-verdict,
`bytes-control-loop` false alarm then correct), against three flips in 73 cases for flash with the
diff. Every js-yaml case ends in an empty answer in at least one repetition — the model reasons at
length over the 129 KB bundle and returns nothing. `ms-91` (a deleted `'minute'` alias) is missed
in both repetitions: with no diff, a removed string literal in a long alias ladder is invisible.

Two readings of the ms/bytes result, and this arm cannot separate them. Either the model reasons
well enough to find a one-character defect unaided, or it is recalling the pristine source of three
very popular MIT libraries and diffing against memory. The second is live: `ms`, `bytes` and
`js-yaml` at these tags are certainly in training data. What the arm does establish is that **a
corpus built from public library sources cannot cleanly measure "can the agent find the defect",
because the answer key is in the model's weights.** A corpus over private or synthetic code would
separate them; this one cannot.

## Spend

**$0.9962 across all eight model-arm-repetitions**, plus about $0.001 for two two-case trial runs,
against the $3 guard. 8,197,535 tokens. Flash accounts for $0.82 of it; the two small models cost
$0.35 combined for four full passes of the whole pool.

Wall time: flash needs ~19 min for a 73-case pass at `--concurrency 8`, dominated by js-yaml, whose
prompts run 40-57k tokens each. The small models finish the same pass in about 1 minute.

## Recommendation

**No honest corpus v2 out of this pool, for flash.** The point of a v2 would be cases where the
naive approach is measurably unreliable. Widening from 12 hand-picked cases to 70 measured ones
made flash's proof rate go *up* (12/12 to 69/70), and the only cases it drops are three one-off
flips that are not reproducibly hard. There is no subset here that could be shipped as "hard for
baseline 1" without misrepresenting a coin flip as a property of the case.

**There is a model tier where this task sits at the frontier, and it is `qwen/qwen3-30b-a3b-instruct-2507`
on the 41 ms+bytes cases.** 26 ± 1 proved out of 41, zero misses, all failures near-misses, a
verdict bit that is always `true` (3/3 false alarms), and a 10-case instability band. Every one of
the stage-1 to stage-3 mechanisms has something to bite on there: the double-run gate has 29
unproved claims to reject, the false alarms are exactly what a verification contract should
suppress, and the instability band gives the effect sizes room to be visible above noise.

Concretely, for the next session: run the stages against `qwen/qwen3-30b-a3b-instruct-2507` over
`sweep/cases/` restricted to ms and bytes, keep flash as the saturated control that shows a stage
does not *break* a strong model, and drop js-yaml from the small-model arms as measured incapacity.
The corpus stays as it is — it is a fine fixture, it just cannot discriminate candidates on flash.

Caveats worth carrying: n=2 per cell, one provider, one prompt; the small models were run at
`--concurrency 8` and one of them hit upstream rate limits; and the contamination question raised
by the no-diff arm applies to every number in this document, because all three libraries are
public.

## Reproducing

```bash
npm run corpus:setup
node corpus/screen.mjs ms && node corpus/screen.mjs bytes && node corpus/screen.mjs js-yaml
node sweep/build-pool.mjs                     # writes sweep/cases/<lib>-<mutantId>/case.json
node sweep/harness.mjs                        # sweep/.harness = src+corpus+eval, cases symlinked
node sweep/.harness/corpus/make-case.mjs      # derive every mutation.diff from case.json
node sweep/.harness/corpus/verify.mjs         # 73/73, the corpus way
bash sweep/run-matrix.sh baseline-1 msbytes $(ls sweep/cases | grep -v '^js-yaml-[0-9]')
bash sweep/run-matrix.sh baseline-1 jsyaml   $(ls sweep/cases | grep '^js-yaml-[0-9]')
SWEEP_MODELS='z-ai/glm-5.3-flash' bash sweep/run-matrix.sh baseline-1-nodiff subset \
  js-yaml-15 js-yaml-18 ms-4 ms-12 ms-72 ms-91 ms-170 bytes-12 bytes-15 bytes-52 \
  ms-control-lookup bytes-control-loop js-yaml-control-hoist
node sweep/analyze.mjs
```

`sweep/.harness/` is rebuilt from source on every `sweep/harness.mjs` run, so the harness under
test cannot drift from `eval/`.
