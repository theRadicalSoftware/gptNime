#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DESKTOP_FILE="$DESKTOP_DIR/gptnime.desktop"
START_SCRIPT="$PROJECT_DIR/scripts/start-gptnime.sh"
ICON_PATH="$PROJECT_DIR/public/brand/gptnime-launcher-icon.png"

mkdir -p "$DESKTOP_DIR"
chmod +x "$START_SCRIPT"

cat >"$DESKTOP_FILE" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=GPTNime
GenericName=Anime Watch Ledger
Comment=Start the GPTNime anime watch ledger
Exec=$START_SCRIPT
Icon=$ICON_PATH
Terminal=false
Categories=Utility;
Keywords=GPTNime;gptNime;anime;watch;ledger;tracker;AniList;rewatch;queue;
StartupNotify=false
EOF

chmod 644 "$DESKTOP_FILE"

if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "$DESKTOP_FILE"
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi

echo "Installed GPTNime launcher:"
echo "$DESKTOP_FILE"
