#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND="$REPO_ROOT/frontend"

# Install node_modules if missing
if [ ! -d "$FRONTEND/node_modules" ]; then
  echo "→ Installing npm dependencies…"
  npm --prefix "$FRONTEND" install
fi

echo "→ Starting GYST frontend on http://localhost:5173"
echo "   Proxying /api → http://127.0.0.1:8000"
echo ""

exec npm --prefix "$FRONTEND" run dev
