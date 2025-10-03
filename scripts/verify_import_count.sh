#!/usr/bin/env bash
set -euo pipefail
CONN=${1:-}
if [[ -z "$CONN" ]]; then
  echo "usage: $0 <postgres-connection-string>" >&2
  exit 2
fi
docker run --rm --network host postgres:15-alpine \
  psql "$CONN" -qtAX -c "select count(*) from scarf_events_raw" | tee count.txt
COUNT=$(tr -d '[:space:]' < count.txt)
echo "Row count in scarf_events_raw: $COUNT"

