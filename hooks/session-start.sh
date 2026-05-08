#!/usr/bin/env bash
# SessionStart hook for chop.
# Reads the hook payload from stdin, records the session info, ensures the
# status server is running, and opens the lumberjack window in a browser
# (only the first time, so resumed sessions don't spawn extra tabs).

set -e

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
RUNTIME_DIR="${HOME}/.claude/chop"
PORT=47823

mkdir -p "$RUNTIME_DIR"

# Read hook payload from stdin (best-effort — if no node, we still continue).
PAYLOAD="$(cat || true)"

# Persist the latest session payload for the server to read.
printf '%s' "$PAYLOAD" > "$RUNTIME_DIR/session.json"
date +%s > "$RUNTIME_DIR/started_at"

# Check whether the server is already running.
SERVER_RUNNING=0
if [ -f "$RUNTIME_DIR/server.pid" ]; then
  EXISTING_PID="$(cat "$RUNTIME_DIR/server.pid" 2>/dev/null || true)"
  if [ -n "$EXISTING_PID" ] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    SERVER_RUNNING=1
  fi
fi

if [ "$SERVER_RUNNING" -eq 0 ]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "chop: node is required but not found on PATH; the lumberjack window will not start." >&2
    exit 0
  fi
  nohup node "$PLUGIN_ROOT/server/server.js" \
    --port "$PORT" \
    --runtime "$RUNTIME_DIR" \
    > "$RUNTIME_DIR/server.log" 2>&1 &
  echo $! > "$RUNTIME_DIR/server.pid"
  disown 2>/dev/null || true

  # Give the server a moment to bind, then open the window.
  sleep 0.4
  if command -v open >/dev/null 2>&1; then
    open "http://localhost:$PORT" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:$PORT" >/dev/null 2>&1 || true
  fi
fi

exit 0
