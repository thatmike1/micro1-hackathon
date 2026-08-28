# improvement changelog

Each row is one iteration on the agent: what changed, the evidence that it helped or did not, and
what was decided as a result.

| stage | what & why | evidence | decision |
| --- | --- | --- | --- |
| 0 | scaffold: agent loop, trajectory logging, HTML render | `npm test` (14 passing), `runs/demo.jsonl`, `runs/smoke-2026-08-28T17-15-15.jsonl` | baseline in place |
| 0 | baseline 1: one prompt, no tools, no execution (`eval/candidates/baseline-1.mjs`) over all 15 cases | `runs/stage0-baseline-1-2026-08-28T18-56-11/`: proof rate **12/12**, false alarms **0/3**, $0.0478, 212k tokens, 6.4 min wall (4 cases in parallel) | the corpus does not discriminate this model: reading the diff is enough, including the designated hard case `js-yaml-15`. Nothing above stage 0 can show a proof-rate gain here |
| 0b | baseline 2: same prompt plus `read-file` and `run-command`, no verification contract (`eval/candidates/baseline-2.mjs`) | `runs/stage0-baseline-2-2026-08-28T18-56-15/`: proof rate **9/12**, false alarms **0/3**, $0.0358, 466k tokens, 13.8 min wall | tools made it worse, not better: 2 js-yaml cases burned all 12 steps exploring and never answered, and `ms-72` shipped a test that was also red on pristine (`ms(ms('1y'))` is `'365d'`, not `'1y'`). The double-run gate caught that one, which is the case stage 1 exists to fix |
