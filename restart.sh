#!/usr/bin/env bash
# Mata o backend atual (via PID do lock, nunca pkill -f), builda e sobe de novo em background.
set -euo pipefail
cd "$(dirname "$0")"

LOCK="$HOME/.claude-code-ui/lock"
if [ -f "$LOCK" ]; then
  PID="$(cat "$LOCK")"
  if kill -0 "$PID" 2>/dev/null; then
    echo "parando processo $PID (SIGTERM, encerramento gracioso)…"
    kill "$PID"
    for _ in $(seq 1 20); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
    kill -0 "$PID" 2>/dev/null && { echo "não parou, forçando…"; kill -9 "$PID"; } || true
  fi
fi

npm run build

nohup npm run start > /tmp/ccui.log 2>&1 &
disown

echo "app reiniciada (pid $!), log em /tmp/ccui.log"
