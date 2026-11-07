#!/bin/sh
# install.sh — install the plugin into the central location (~/.vibe/plugins/ticketing).
# The repo root IS the plugin package. Project scope (per-repo, trusted folder only):
#   mkdir -p .vibe/plugins && cp -R <this-repo> .vibe/plugins/ticketing
# Global scope (all projects):
#   ./install.sh
set -eu
DEST="${HOME}/.vibe/plugins/ticketing"
SRC="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
rm -rf "$DEST/.git" "$DEST/.tmp" "$DEST/.vibe"
echo "installed: $DEST"
echo "reload with /reload"
