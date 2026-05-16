#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$REPO_ROOT/backend"
VENV="$BACKEND/.venv"

# Create venv and install if missing
if [ ! -f "$VENV/bin/uvicorn" ]; then
  echo "→ Setting up Python venv…"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q -e "$BACKEND[dev]"
fi

echo "→ Running migrations…"
cd "$BACKEND" && "$VENV/bin/alembic" upgrade head

echo "→ Starting GYST backend on http://127.0.0.1:8000"
echo "   API docs: http://127.0.0.1:8000/api/docs"
echo ""

cd "$BACKEND"
exec "$VENV/bin/uvicorn" gyst.main:app \
  --host 127.0.0.1 \
  --port 8000 \
  --reload \
  --reload-dir gyst
