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
