#!/usr/bin/env bash
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
. "$DIR/common.sh"

IMAGE=${1:-}
WORKDIR=${2:-/github/workspace}

if [[ -z "$IMAGE" ]]; then
  echo "usage: $0 <image[:tag]> [workdir]" >&2
  exit 2
fi

set +e
OUTPUT=$(docker run --rm -w "$WORKDIR" "$IMAGE" 2>&1)
STATUS=$?
set -e
log "Container exit code: ${STATUS}"
echo "--- Begin Container Output ---"
echo "$OUTPUT"
echo "--- End Container Output ---"

if [[ "$STATUS" -eq 0 ]]; then
  echo "ERROR: container exited 0; expected non-zero due to missing env var" >&2
  exit 1
fi

if echo "$OUTPUT" | grep -Eqi "npm error|Could not read package.json|enoent.*package.json"; then
  echo "Unexpected npm/package.json error detected. Entry point fix failed." >&2
  exit 1
fi

if echo "$OUTPUT" | grep -q "missing env variable: SCARF_API_TOKEN"; then
  log "Smoke test passed: entrypoint runs from /app and app executed."
  exit 0
fi

echo "Did not observe expected app error. Output above for debugging." >&2
exit 1

