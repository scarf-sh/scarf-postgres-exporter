#!/usr/bin/env bash
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
. "$DIR/common.sh"

IMAGE=${1:-}
if [[ -z "$IMAGE" ]]; then
  echo "usage: $0 <image[:tag]>" >&2
  exit 2
fi

NAME=rg-pg

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "Starting postgres"
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=scarf -p 5432:5432 postgres:15-alpine >/dev/null

log "Waiting for postgres"
docker run --rm --network host postgres:15-alpine sh -lc 'until pg_isready -h localhost -U postgres >/dev/null 2>&1; do sleep 1; done'

log "Seeding today's row"
docker run --rm --network host postgres:15-alpine \
  psql "postgres://postgres:pass@localhost:5432/scarf" -qtAX -c "create table if not exists scarf_events_raw (id text, type text, package text, pixel text, version text, time timestamp, referer text, user_agent text, platform text, variables text, origin_id text, origin_latitude numeric, origin_longitude numeric, origin_country text, origin_city text, origin_postal text, origin_connection_type text, origin_company text, origin_domain text, dnt boolean, confidence numeric, endpoint_id text, origin_state text, mtc_quota_exceeded boolean); insert into scarf_events_raw(time) values (now());"

set +e
OUTPUT=$(docker run --rm \
  --network host \
  -e SCARF_API_TOKEN=dummy \
  -e SCARF_ENTITY_NAME=dummy \
  -e PSQL_CONN_STRING='postgres://postgres:pass@localhost:5432/scarf' \
  "$IMAGE" 2>&1)
STATUS=$?
set -e
echo "$OUTPUT"

if echo "$OUTPUT" | grep -qi "downloading CSV"; then
  echo "Expected skip due to today's data, but saw a download." >&2
  exit 1
fi
if ! echo "$OUTPUT" | grep -qi "Already up to date"; then
  echo "Did not observe skip message." >&2
  exit 1
fi
log "Range guard passed"

