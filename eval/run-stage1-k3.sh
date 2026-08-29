#!/usr/bin/env bash
# Stage 1 (prover loop with the double-run gate), k=3 repetitions, at the stage-0 pinned configs.
#
#   eval/run-stage1-k3.sh flash|qwen
#
# Same engines, providers, case sets and repetition count as `run-baselines-k3.sh`, so the stage-1
# numbers sit next to the stage-0 rows without a config difference to argue about. The one knob
# that is new is `--max-tokens 4096`: the stage-0 k=3 arms sent no cap and three qwen generations
# ran to the provider's 65,536-token default. It is pinned here and deliberately not retrofitted
# into the stage-0 arms, whose numbers were measured without it.
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
  out="runs/stage1-${engine}-rep${rep}"
  [ -f "$out/summary.json" ] && { echo "[stage1] $out already done"; continue; }
  echo "[stage1] stage-1 $model rep $rep -> $out"
  node eval/run-eval.mjs \
    --candidate stage-1 --model "$model" --concurrency "$concurrency" --out "$out" \
    --max-tokens 4096 \
    "${pin[@]}" ${cases[0]+"${cases[@]}"}
done
