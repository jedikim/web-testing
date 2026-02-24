#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SAMPLES_DIR="$ROOT_DIR/runs/samples"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for artifact validation" >&2
  exit 1
fi

required_root_fields=(runId workflowId status startedAt endedAt durationMs context steps failures review evidence)

for file in "$SAMPLES_DIR"/*.json; do
  [ -f "$file" ] || continue

  jq empty "$file" >/dev/null

  for field in "${required_root_fields[@]}"; do
    jq -e --arg field "$field" 'has($field)' "$file" >/dev/null
  done

  jq -e '.status == "pass" or .status == "fail" or .status == "blocked"' "$file" >/dev/null
  jq -e '.review.decision == "approve" or .review.decision == "rework" or .review.decision == "not_run"' "$file" >/dev/null

  jq -e '.steps | type == "array"' "$file" >/dev/null
  jq -e '.failures | type == "array"' "$file" >/dev/null
  jq -e '.evidence | type == "array"' "$file" >/dev/null

done

echo "run artifact validation passed"
