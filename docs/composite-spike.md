# composite spike — does hiding the mutation inside a refactor defeat baseline 1?

**No.** Baseline 1 proved every composite case on both repetitions, 6/6, and stayed silent on the
control both times. On every run it named the mutated span explicitly and said in its own note
which parts of the surrounding refactor were equivalent. The composite corpus restores no headroom.

Branch `worktree-composite-spike`, not merged. Nothing under `corpus/cases/`, `eval/` or
`CHANGELOG.md` changed.

## What was built

Three composite cases, each hiding an existing case's mutation inside a genuine same-file refactor
of the region it lives in, in the shape the controls already use:

| case | base | refactor | smuggled mutation |
|---|---|---|---|
| `ms-170-composite` | `ms-170` | `fmtLong`'s unit ladder becomes a table-driven loop over a hoisted `LONG_UNITS`; `plural` is renamed `pluralize` and its suffix built separately | `msAbs >= n * 1.5` → `msAbs > n * 1.5` |
| `bytes-52-composite` | `bytes-52` | `format`'s option reading is hoisted into `formatOptions`, its unit ladder into `formatUnit` | the hoist writes `decimalPlaces: has ? options.decimalPlaces : 2`, dropping the `!== undefined` check |
| `js-yaml-15-composite` | `js-yaml-15` | both integer patterns decomposed into alternation arrays built by `anchoredAlternation`, the parser's radix branches become a prefix table, the resolver picks its pattern up front | the binary alternative is written `[^-+]?0b[0-1]+` among three sibling `[-+]?` fragments |

The control is the existing `ms-control-lookup`, unchanged — it is already a whole-region refactor
of the same shape.

Diff sizes: 33 lines replaced by 40 (ms), 63 by 92 (bytes), 21 by 38 (js-yaml). The base cases are
one-line diffs.

### Verification

`node corpus/verify.mjs` over all four, the corpus way — diff applies, the library's own full suite
green on the patched checkout, differential probe diverges on the recorded input:

```
PASS  bytes-52-composite     buggy    suite green, 71/465 probes diverge on bytes.format(0, { fixedDecimals: true })
PASS  js-yaml-15-composite   buggy    suite green, 4/655 probes diverge on load('a: !!int -0b101')
PASS  ms-170-composite       buggy    suite green, 5/1071 probes diverge on ms(1500, {long: true})
PASS  ms-control-lookup      control  suite green, probe silent over 1071 inputs
```

The diverging-probe counts (71, 4, 5) are identical to the base cases', so each composite is
observably the same defect as its base and the two scores compare like for like.

## Results

Baseline 1 unchanged, `z-ai/glm-5.3-flash`, `--concurrency 4`, two repetitions. Runs are
`runs/composite-baseline-1-rep1/` and `runs/composite-baseline-1-rep2/`.

| case | rep 1 | rep 2 | located the mutated span? |
|---|---|---|---|
| `ms-170-composite` | proved | proved | yes, both — named the `>=` → `>` change and called the loop conversion equivalent |
| `bytes-52-composite` | proved | proved | yes, both — named the dropped `!== undefined` and the `toFixed(undefined)` consequence |
| `js-yaml-15-composite` | proved | proved | yes, both — quoted `[^-+]?` vs `[-+]?` on the binary alternative |
| `ms-control-lookup` | correct | correct | n/a; argued equivalence from the key set and the anchored regex |

Proof rate 3/3 both reps, false alarms 0/1 both reps. No misses, no unproved claims, no unparseable
answers, no errors.

The emitted tests are direct hits, not lucky shotguns. `ms-170-composite` rep 1 asserts
`ms(1500, {long: true}) === '2 seconds'` plus the same boundary at minutes, hours and days.
`js-yaml-15-composite` rep 2 asserts `load('!!int -0b101') === -5` and `load('!!int +0b11') === 3`,
then adds unsigned `0b101` as a case that must keep working on both builds. Every one of the six
notes separates the equivalent half of the refactor from the defect in so many words.

### Cost

| run | tokens | cost | wall |
|---|---|---|---|
| composite rep 1 | 80,582 | $0.0238 | 5.1 min |
| composite rep 2 | 77,050 | $0.0219 | 4.1 min |
| the same 4 cases in stage 0 (base, n=1) | 71,171 | $0.0169 | — |

Spike total **$0.0457**. Per case the composite runs are roughly 10% more tokens than the base
cases in stage 0, driven by longer reasoning traces on the larger diffs; `js-yaml-15` dominates
both columns either way (43-57k tokens on its own). Wall times are not comparable — the stage-0
run packed 15 cases into a pool of 4 and this one packed 4.

## Verdict

The hypothesis is wrong for this model. Burying the mutation in a real refactor does not collapse
the single-prompt proof rate; it does not move it at all, at n=6. It also did not cost a false
alarm, so the harder judgement call ("most of this diff is genuinely equivalent") did not push the
model toward crying wolf either.

What the runs suggest about why: the model is not pattern-matching a one-line diff, it is reading
the post-change file and reasoning about semantics. A larger diff gives it more to read and slightly
more to reason about, and it reasons through it. The stage-0 finding stands and generalises further
than it looked — on this corpus and this model, reading the change is enough, and diff size is not
the axis that separates candidates.

Two caveats worth naming before this is treated as settled. Three buggy cases and one model is thin
evidence, and the three refactors are mine — I knew where the mutation was while writing them, which
is a real bias toward refactors that leave the defect legible. A refactor authored without that
knowledge, or a mutation placed where the refactor genuinely obscures causality (a value threaded
through several renamed intermediates, say), is not what was tested here.

## Reproducing

`corpus/case-edit.mjs` resolves cases from `corpus/cases/` and nowhere else, and this spike may not
change `corpus/` or `eval/`. So the composite cases live in `spike/cases/` and are copied into place
for the duration of a run, which lets `corpus/make-case.mjs`, `corpus/verify.mjs` and
`eval/run-eval.mjs` all run completely unchanged — the experiment is baseline 1 unchanged, so the
harness around it has to be unchanged too. `node spike/stage.mjs off` leaves `corpus/cases/` as git
found it.

```bash
npm run corpus:setup
node spike/author.mjs                       # build case.json from spike/replacements/*.txt
node spike/stage.mjs on
node corpus/make-case.mjs ms-170-composite bytes-52-composite js-yaml-15-composite
node corpus/verify.mjs ms-170-composite bytes-52-composite js-yaml-15-composite ms-control-lookup
node eval/run-eval.mjs --candidate baseline-1 --concurrency 4 \
  --out runs/composite-baseline-1-rep1 \
  --cases ms-170-composite bytes-52-composite js-yaml-15-composite ms-control-lookup
node spike/stage.mjs off
```

`spike/author.mjs` reads each span's `original` out of the pristine entry module rather than
carrying a copy, so a case cannot drift from the file it patches.
