#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="GPTNime"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${GPTNIME_HOST:-127.0.0.1}"
PORT="${GPTNIME_PORT:-5190}"
URL="http://${HOST}:${PORT}/"
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/gptnime"
LOG_FILE="$LOG_DIR/gptnime-dev.log"
PID_FILE="$LOG_DIR/gptnime-dev.pid"
ICON_PATH="$PROJECT_DIR/public/brand/gptnime-launcher-icon.png"

notify_user() {
  if command -v notify-send >/dev/null 2>&1; then
    notify-send "$APP_NAME" "$1" -i "$ICON_PATH" >/dev/null 2>&1 || true
  fi
}

open_app() {
  if command -v xdg-open >/dev/null 2>&1; then
    nohup xdg-open "$URL" >/dev/null 2>&1 &
  fi
}

ensure_node_runtime() {
  if command -v npm >/dev/null 2>&1; then
    return
  fi

  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # Desktop launchers often do not inherit the interactive shell's Node path.
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh"
    nvm use --silent >/dev/null 2>&1 || nvm use --silent node >/dev/null 2>&1 || true
  fi

  if ! command -v npm >/dev/null 2>&1; then
    notify_user "Could not find npm. Open a terminal and run npm install from the GPTNime project."
    echo "npm was not found in PATH." >&2
    exit 1
  fi
}

server_is_ready() {
  command -v curl >/dev/null 2>&1 && curl -fsS --max-time 1 "$URL" >/dev/null 2>&1
}

mkdir -p "$LOG_DIR"
cd "$PROJECT_DIR"
ensure_node_runtime

if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  notify_user "Installing project dependencies. This may take a minute."
  npm install >>"$LOG_FILE" 2>&1
fi

if server_is_ready; then
  open_app
  exit 0
fi

notify_user "Starting the watch ledger."
nohup npm run dev -- --host "$HOST" --port "$PORT" >>"$LOG_FILE" 2>&1 &
echo "$!" >"$PID_FILE"

for _ in $(seq 1 80); do
  if server_is_ready; then
    open_app
    notify_user "GPTNime is running."
    exit 0
  fi
  sleep 0.25
done

open_app
notify_user "GPTNime was started. If the page is not ready yet, wait a moment and refresh."
