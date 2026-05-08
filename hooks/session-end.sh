#!/usr/bin/env bash
# SessionEnd hook for chop. Stops the status server (if running).

set -e

RUNTIME_DIR="${HOME}/.claude/chop"

if [ -f "$RUNTIME_DIR/server.pid" ]; then
  PID="$(cat "$RUNTIME_DIR/server.pid" 2>/dev/null || true)"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
  fi
  rm -f "$RUNTIME_DIR/server.pid"
fi

exit 0
