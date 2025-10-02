#!/usr/bin/env bash
set -euo pipefail

# GitHub Actions sets --workdir to /github/workspace when using docker:// images,
# which breaks npm-based commands that expect /app. We force the CWD here.
cd /app

exec node index.js

