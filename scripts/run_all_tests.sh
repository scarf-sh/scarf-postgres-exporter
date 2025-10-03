#!/usr/bin/env bash
set -euo pipefail

IMAGE_REF=${1:-}
if [[ -z "$IMAGE_REF" ]]; then
  echo "usage: $0 <image[:tag]>" >&2
  exit 2
fi

# Optional GHCR auth (recommended on CI). Provide GHCR_USERNAME and GHCR_TOKEN.
if [[ -n "${GHCR_TOKEN:-}" ]]; then
  echo "Logging in to GHCR as ${GHCR_USERNAME:-github-actor}" >&2
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USERNAME:-github-actor}" --password-stdin >/dev/null
fi

echo "[tests] Running TypeScript unit tests" >&2
npm ci
npm test

echo "[tests] Checking for shell spawn regressions" >&2
bash scripts/check_no_shell_spawn.sh

echo "[tests] Smoke testing entrypoint" >&2
bash scripts/smoke_entrypoint.sh "$IMAGE_REF"

echo "[tests] Testing psql invocation against special chars" >&2
bash scripts/test_psql_injection.sh "$IMAGE_REF"

echo "[tests] Running range guard (applies schema + seeds today)" >&2
bash scripts/range_guard.sh "$IMAGE_REF"

echo "[tests] All tests passed" >&2

