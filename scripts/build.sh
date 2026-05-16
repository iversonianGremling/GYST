#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND="$REPO_ROOT/frontend"
BACKEND="$REPO_ROOT/backend"
VENV="$BACKEND/.venv"

echo "→ Building frontend…"
npm --prefix "$FRONTEND" ci
npm --prefix "$FRONTEND" run build
echo "   dist/ ready at frontend/dist/"

echo "→ Verifying backend imports…"
"$VENV/bin/python" -c "from gyst.main import app; print('   backend ok')"

echo ""
echo "✓ Build complete. Serve with: scripts/prod.sh"
