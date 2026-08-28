# micro1-hackathon

<!-- TODO: one-line pitch -->

## Intended user

<!-- TODO: who runs this, in what job, at what moment -->

## The bottleneck

<!-- TODO: the specific step that costs them time or accuracy today -->

## Why it matters

<!-- TODO: what changes for them when the bottleneck is gone; how the improvement is measured -->

## How it works

A bespoke agent loop over OpenRouter's OpenAI-compatible chat completions API. Every run writes a
JSONL trajectory (`runs/`) that renders to a self-contained HTML page, so each episode can be read
back step by step: what the agent did, how the tools responded, where it retried, where a human
approved something.

- `src/agent-loop.mjs` tool-use loop with retry/backoff, usage aggregation and approval checkpoints
- `src/trajectory.mjs` JSONL event writer; the event schema is documented in the file's JSDoc block
- `src/render-trajectory.mjs` trajectory to standalone HTML

Zero runtime dependencies, Node 20+, plain ESM.

## Commands

| command | what it does |
| --- | --- |
| `npm test` | node:test suite: loop control flow and trajectory schema |
| `npm run demo` | offline scripted run against a mock transport; writes `runs/demo.jsonl` and `demo.html` |
| `npm run smoke` | one real OpenRouter run with two real tools; writes `runs/smoke-*.jsonl` and its HTML |
| `npm run render -- runs/<file>.jsonl -o out.html` | render any trajectory |

`npm run smoke` needs `OPENROUTER_API_KEY` in the environment or in a gitignored `.env`.
