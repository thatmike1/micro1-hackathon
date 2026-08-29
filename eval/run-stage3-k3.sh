#!/usr/bin/env bash
# Stage 3 (cross-case memory file), k=3 repetitions, both halves of the on/off ablation.
#
#   eval/run-stage3-k3.sh flash|qwen [on|off]
#
# Same engines, providers, case slices, gate budget and `--max-tokens 4096` as stages 1 and 2.
# Two things are new, and both are forced by the feature rather than chosen:
#
#   * `--concurrency 1`. A candidate that carries a file from one case to the next has to answer
#     the cases one at a time, and the order it sees them in is part of the measurement. Earlier
#     stages ran four cases in parallel, so their wall times are not comparable with these.
#   * the base stage is per engine, because row 2 left the shipped configuration split: stage 2 on
#     flash, stage 1 on qwen. Memory is measured on top of what each engine actually ships.
#
# The order is `loadCases()`'s, which is case id order, and it is recorded in every summary.json
# as `order`. Both arms of the ablation run it, so on and off see the same cases in the same
# sequence and differ only by the memory file.
set -euo pipefail

engine="${1:?engine: flash|qwen}"
memory="${2:-both}"
reps="${REPS:-3}"

case "$engine" in
  flash)
    model="z-ai/glm-5.3-flash"
    base="stage-2"
    pin=(--provider "Z.AI" --require-parameters --reasoning low)
    cases=()
    ;;
  qwen)
    model="qwen/qwen3-30b-a3b-instruct-2507"
    base="stage-1"
    pin=(--provider "CoreWeave" --require-parameters)
    cases=(--cases bytes-12 bytes-15 bytes-52 bytes-control-loop ms-4 ms-12 ms-27 ms-30 ms-70 ms-72 ms-170 ms-control-lookup)
    ;;
  *) echo "unknown engine: $engine" >&2; exit 1 ;;
esac

case "$memory" in
  on|off) arms=("$memory") ;;
  both) arms=(on off) ;;
  *) echo "unknown memory arm: $memory" >&2; exit 1 ;;
esac

for arm in "${arms[@]}"; do
  for rep in $(seq 1 "$reps"); do
    out="runs/stage3-${engine}-${arm}-rep${rep}"
    [ -f "$out/summary.json" ] && { echo "[stage3] $out already done"; continue; }
    echo "[stage3] stage-3 base=$base memory=$arm $model rep $rep -> $out"
    node eval/run-eval.mjs \
      --candidate stage-3 --model "$model" --concurrency 1 --out "$out" \
      --max-tokens 4096 \
      --option "base=$base" --option "memory=$arm" \
      "${pin[@]}" ${cases[0]+"${cases[@]}"}
  done
done
