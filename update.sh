#!/usr/bin/env bash
# Run from inside the LXC container to update Tunarr.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Stopping Tunarr…"
systemctl stop tunarr

echo "Pulling latest code…"
git -C "${APP_DIR}" pull --ff-only

echo "Updating Python dependencies…"
"${APP_DIR}/venv/bin/pip" install --quiet --upgrade pip
"${APP_DIR}/venv/bin/pip" install --quiet -r "${APP_DIR}/requirements.txt"

echo "Starting Tunarr…"
systemctl start tunarr

echo "✓ Done. Check logs: journalctl -u tunarr -f"
