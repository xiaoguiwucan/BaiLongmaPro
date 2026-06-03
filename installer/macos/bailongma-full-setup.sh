#!/bin/zsh
set -euo pipefail

APP_PATH="${BAILONGMA_APP_PATH:-/Applications/Bailongma.app}"
APP_NAME="Bailongma"
USER_DATA_DIR="$HOME/Library/Application Support/Bailongma"
LOG_DIR="$USER_DATA_DIR/logs"
SETUP_LOG="$LOG_DIR/full-setup.log"
APP_HEALTH_URL="http://127.0.0.1:3721/status"

mkdir -p "$LOG_DIR"
exec > >(tee -a "$SETUP_LOG") 2>&1

say_step() {
  printf '\n[%s] %s\n' "$(date '+%F %T')" "$1"
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

wait_http() {
  local url="$1"
  local seconds="${2:-120}"
  local waited=0
  while [ "$waited" -lt "$seconds" ]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}

start_bailongma() {
  say_step "Opening $APP_NAME"
  /usr/bin/open -a "$APP_PATH"
  wait_http "$APP_HEALTH_URL" 90 || fail "Bailongma backend did not become healthy at $APP_HEALTH_URL"
}

print_summary() {
  say_step "Full setup complete"
  echo "Bailongma: $APP_HEALTH_URL"
  echo "Logs:      $SETUP_LOG"
  echo
  echo "Still required for 100% feature use:"
  echo "- Enter your LLM/API keys in Bailongma settings."
  echo "- Scan WeChat login QR inside the app."
  echo "- Authorize macOS microphone/screen/file permissions when prompted."
  echo "- Install/login optional external CLIs such as Claude Code, Codex, or Hermes if you want those integrations."
  echo
  echo "Docker is not required for the default embedded local memory engine."
}

say_step "Starting Bailongma full setup"
[ -d "$APP_PATH" ] || fail "Bailongma.app not found at $APP_PATH"
start_bailongma
print_summary
