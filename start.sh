#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js belum terpasang. Unduh di https://nodejs.org"; exit 1; }
[ -d node_modules/ssh2 ] || npm install --omit=dev --no-audit --no-fund
export PORT="${PORT:-8787}"
export HOST="${HOST:-127.0.0.1}"
echo "Buka http://$HOST:$PORT"
exec node server.js
