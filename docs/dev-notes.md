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
