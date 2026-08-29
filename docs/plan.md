# build plan — silent mutant

Agent reviews a diff against a green-suite library and proves the bug: a test that fails on the patched checkout and passes on pristine, both via exit codes. Primary metric: cases proved in EVERY one of k=3 repetitions, plus false-alarm rate over the clean controls; single-run proof rates are reported alongside (see CHANGELOG row 0f for why the single run was hiding the headroom). Two engines: `qwen/qwen3-30b-a3b-instruct-2507` pinned to CoreWeave over the ms+bytes cases (the frontier tier) and `z-ai/glm-5.3-flash` pinned to Z.AI at effort low over all 15 (the saturated control). Full sketch: ideation report §3.1 (external), measured corpus feasibility: spike report (external).

## phases

- [x] scaffold: agent loop over OpenRouter, trajectory JSONL, HTML renderer, 14 tests, live smoke on z-ai/glm-5.3-flash
- [x] corpus: 12 cases + 3 equivalent-refactor controls from pinned tags (ms@2.1.3 backbone, js-yaml targeted regions, bytes.js if it spikes green), differential probe script, `npm run corpus:verify` green
- [x] notebook design applied to trajectory renderer (tokens + structure; witness lines only from checkpoint events)
- [x] stage 0: baseline 1 (single prompt, no execution) over full corpus — record scores in CHANGELOG.md
- [x] stage 0b: baseline 2 (agent with read/bash tools, no verification contract) — record
- [x] stage 0 re-measure: both baselines, both engines, pinned configs, k=3 reps each — record
- [ ] stage 1: prover loop with double-run gate, max 3 retries — measure, record
- [ ] stage 2: hypothesizer/prover split — measure, record
- [ ] stage 3: cross-case memory file — measure, record, keep the on/off ablation
- [ ] review-package HTML per case (diff, hypothesis ledger, both runner outputs, retries)
- [ ] eval runner + scoreboard (baseline vs stages, same cases, exit-code scored)
- [ ] repro guide, tested from a clean clone (setup, exact commands, versions, runtime, cost)
- [ ] README: user, bottleneck, value; disclosure that everything here was written during the event; third-party tools named (Stryker, mocha, OpenRouter)
- [ ] trajectories: representative runs per agent, rendered + raw JSONL
- [ ] video ≤5 min per the beat sheet in the ideation report
- [ ] changelog closed with main failure mode + hot take (discriminability scarcity)
- [ ] submit before Mon 01:59 CEST

## rules

- every measured stage appends a CHANGELOG.md row with real numbers before the next stage starts
- nothing enters the corpus unverified (suite green on mutant, probe divergence recorded; controls: suite green, no divergence)
- no code copied from anywhere pre-existing; deps require a one-line justification
