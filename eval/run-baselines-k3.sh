#!/usr/bin/env bash
# Canonical stage-0 baselines, k=3 repetitions, at the pinned configs.
#
#   eval/run-baselines-k3.sh flash|qwen
#
# One engine per invocation, so the two engines can run side by side against different providers.
# Every run pins the provider and records the exact request knobs in its `summary.json`.
#
# flash — `z-ai/glm-5.3-flash`, Z.AI pinned, reasoning effort low: the config the repin arms
#   settled on (armC: same accuracy as default reasoning at a third of the cost). All 15 cases.
# qwen  — `qwen/qwen3-30b-a3b-instruct-2507`, CoreWeave pinned (bf16, the only unquantised
#   endpoint), ms+bytes cases only, per the sweep's measured 0/58 on js-yaml. No `reasoning`
#   field: no endpoint for this instruct build declares the parameter, and sending one under
#   `require_parameters` is an HTTP 404 from the router.
set -euo pipefail

engine="${1:?engine: flash|qwen}"
reps="${REPS:-3}"
concurrency="${CONCURRENCY:-4}"

case "$engine" in
  flash)
    model="z-ai/glm-5.3-flash"
    pin=(--provider "Z.AI" --require-parameters --reasoning low)
    cases=()
    ;;
  qwen)
    model="qwen/qwen3-30b-a3b-instruct-2507"
    pin=(--provider "CoreWeave" --require-parameters)
    cases=(--cases bytes-12 bytes-15 bytes-52 bytes-control-loop ms-4 ms-12 ms-27 ms-30 ms-70 ms-72 ms-170 ms-control-lookup)
    ;;
  *) echo "unknown engine: $engine" >&2; exit 1 ;;
esac

for candidate in baseline-1 baseline-2; do
  for rep in $(seq 1 "$reps"); do
    out="runs/day2-${candidate}-${engine}-rep${rep}"
    [ -f "$out/summary.json" ] && { echo "[k3] $out already done"; continue; }
    echo "[k3] $candidate $model rep $rep -> $out"
    node eval/run-eval.mjs \
      --candidate "$candidate" --model "$model" --concurrency "$concurrency" --out "$out" \
      "${pin[@]}" ${cases[0]+"${cases[@]}"}
  done
done
