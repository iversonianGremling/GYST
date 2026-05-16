#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$REPO_ROOT/backend/.venv"

if [ $# -ne 1 ]; then
  echo "Usage: $0 <password>"
  exit 1
fi

HASH=$("$VENV/bin/python" -c "from gyst.auth import hash_password; print(hash_password('$1'))")
SECRET=$("$VENV/bin/python" -c "import secrets; print(secrets.token_hex(32))")

echo ""
echo "Add these to gyst.toml under [auth]:"
echo ""
echo "  password_hash = \"$HASH\""
echo "  secret_key    = \"$SECRET\""
echo ""
