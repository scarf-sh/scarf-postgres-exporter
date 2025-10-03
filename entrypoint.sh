#!/usr/bin/env bash
set -euo pipefail

# GitHub Actions sets --workdir to /github/workspace when using docker:// images,
# which breaks npm-based commands that expect /app. We force the CWD here.
cd /app

# compiled output lives in dist/src
exec node dist/src/index.js
