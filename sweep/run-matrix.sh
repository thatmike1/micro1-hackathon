#!/usr/bin/env bash
# Runs one arm of the sweep over one batch of cases: every model, both repetitions, sequentially.
#
#   sweep/run-matrix.sh <arm> <batch> [caseId...]
#
# `arm` is a candidate name (`baseline-1`, `baseline-1-nodiff`), `batch` names the slice of the
# pool being run so several batches can share a model-repetition column in `sweep/analyze.mjs`.
# With no case ids the whole pool under `sweep/cases/` runs.
#
# Everything goes through `sweep/.harness/eval/run-eval.mjs`, which is `eval/run-eval.mjs`
# unchanged, pointed at `sweep/cases/` instead of `corpus/cases/`.
set -euo pipefail

arm="${1:?arm}"
batch="${2:?batch}"
shift 2
cases=("$@")

models=(
  "z-ai/glm-5.3-flash"
  "qwen/qwen3-30b-a3b-instruct-2507"
  "mistralai/mistral-small-3.2-24b-instruct"
)
[ -n "${SWEEP_MODELS:-}" ] && read -r -a models <<< "$SWEEP_MODELS"

for model in "${models[@]}"; do
  slug="${model##*/}"
  for rep in 1 2; do
    out="runs/sweep-${arm}-${slug}-${batch}-rep${rep}"
    [ -f "$out/summary.json" ] && { echo "[matrix] $out already done"; continue; }
    echo "[matrix] $arm $model rep $rep -> $out"
    node sweep/.harness/eval/run-eval.mjs \
      --candidate "$arm" --model "$model" --concurrency "${SWEEP_CONCURRENCY:-8}" --out "$out" \
      ${cases[0]+--cases "${cases[@]}"}
  done
done
