#!/usr/bin/env bash
# Stage 2 (hypothesizer/prover split over the stage-1 gate), k=3 repetitions.
#
#   eval/run-stage2-k3.sh flash|qwen
#
# Identical to `run-stage1-k3.sh` in every knob that is not the candidate: same models, same
# providers, same case slices, same `--max-tokens 4096`, same concurrency and repetition count.
# Stage 2 also keeps the stage-1 gate budget — four attempts per case, now split two per
# hypothesis — so the comparison against the stage-1 row is a comparison of the split and not of
# the budget.
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

for rep in $(seq 1 "$reps"); do
  out="runs/stage2-${engine}-rep${rep}"
  [ -f "$out/summary.json" ] && { echo "[stage2] $out already done"; continue; }
  echo "[stage2] stage-2 $model rep $rep -> $out"
  node eval/run-eval.mjs \
    --candidate stage-2 --model "$model" --concurrency "$concurrency" --out "$out" \
    --max-tokens 4096 \
    "${pin[@]}" ${cases[0]+"${cases[@]}"}
done
