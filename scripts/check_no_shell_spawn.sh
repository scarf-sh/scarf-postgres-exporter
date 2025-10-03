#!/usr/bin/env bash
set -euo pipefail

if grep -R --include='*.ts' --include='*.js' -n -E "spawn\(['\"]bash['\"]" .; then
  echo "Found shell-based spawn usage. This is unsafe for connection strings with special characters." >&2
  exit 1
fi
echo "No bash-based spawn usage detected."

