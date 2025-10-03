#!/usr/bin/env bash
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
. "$DIR/common.sh"

IMAGE=${1:-}
if [[ -z "$IMAGE" ]]; then
  echo "usage: $0 <image[:tag]>" >&2
  exit 2
fi

set +e
OUTPUT=$(docker run --rm \
  -e SCARF_API_TOKEN=dummy \
  -e SCARF_ENTITY_NAME=dummy \
  -e PSQL_CONN_STRING='postgres://user:p%40ss;word@localhost:5432/dbname' \
  "$IMAGE" 2>&1)
STATUS=$?
set -e
log "Container exit code: ${STATUS}"
echo "--- Begin Output ---"
echo "$OUTPUT"
echo "--- End Output ---"

if echo "$OUTPUT" | grep -q "-qtAX: command not found"; then
  echo "Detected unsafe shell splitting in psql invocation." >&2
  exit 1
fi
log "Psql invocation appears shell-safe."

