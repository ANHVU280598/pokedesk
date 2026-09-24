#!/usr/bin/env bash
# Start, pull, and restart Catalog Desk (API :8765, UI :43123).
# macOS bash 3 compatible. No extra services.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_PORT=8765
UI_PORT=43123
RUN_DIR="$ROOT/.catalog-desk"
API_LOG="$RUN_DIR/api.log"
UI_LOG="$RUN_DIR/ui.log"
API_PID="$RUN_DIR/api.pid"
UI_PID="$RUN_DIR/ui.pid"

port_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
    return 0
  fi
  return 0
}

port_open() {
  local pids
  pids="$(port_pids "$1")"
  [[ -n "${pids//[$' \n']/}" ]]
}

stop_port() {
  local port="$1"
  local name="$2"
  local pids
  pids="$(port_pids "$port" | tr '\n' ' ')"
  if [[ -z "${pids// }" ]]; then
    echo "$name is not listening on $port"
    return 0
  fi
  echo "Stopping $name on port $port (pid ${pids})"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  local i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if ! port_open "$port"; then
      echo "$name stopped"
      return 0
    fi
    sleep 0.25
  done
  pids="$(port_pids "$port" | tr '\n' ' ')"
  if [[ -n "${pids// }" ]]; then
    echo "Force-stopping $name on port $port"
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
    sleep 0.3
  fi
  if port_open "$port"; then
    echo "Could not free port $port" >&2
    return 1
  fi
  echo "$name stopped"
}

wait_http() {
  local url="$1"
  local label="$2"
  local i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 \
           21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 \
           41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60; do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then
      echo "$label is up: $url"
      return 0
    fi
    sleep 0.5
  done
  echo "$label did not become ready: $url" >&2
  echo "See $API_LOG and $UI_LOG" >&2
  return 1
}

cmd_stop() {
  stop_port "$UI_PORT" "UI"
  stop_port "$API_PORT" "API"
  rm -f "$API_PID" "$UI_PID"
}

cmd_start() {
  mkdir -p "$RUN_DIR"
  if [[ ! -x "$ROOT/.venv/bin/uvicorn" ]]; then
    echo "Missing .venv. From the repo root, create it and install requirements, then: .venv/bin/playwright install chromium" >&2
    exit 1
  fi
  if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
    echo "Missing frontend/node_modules. From frontend/: npm install" >&2
    exit 1
  fi

  if port_open "$API_PORT"; then
    echo "API already listening on http://127.0.0.1:$API_PORT"
  else
    echo "Starting API on http://127.0.0.1:$API_PORT"
    nohup "$ROOT/.venv/bin/uvicorn" app.main:app --app-dir backend --host 127.0.0.1 --port "$API_PORT" \
      >"$API_LOG" 2>&1 &
    echo $! >"$API_PID"
    wait_http "http://127.0.0.1:$API_PORT/api/health" "API"
  fi

  if port_open "$UI_PORT"; then
    echo "UI already listening on http://127.0.0.1:$UI_PORT"
  else
    echo "Starting UI on http://127.0.0.1:$UI_PORT"
    (
      cd "$ROOT/frontend"
      nohup npm run dev >"$UI_LOG" 2>&1 &
      echo $! >"$UI_PID"
    )
    wait_http "http://127.0.0.1:$UI_PORT/" "UI"
  fi
  echo "Catalog Desk: http://127.0.0.1:$UI_PORT"
}

cmd_pull() {
  local branch
  branch="$(git rev-parse --abbrev-ref HEAD)"
  echo "Pulling ${branch} with git pull --ff-only"
  git pull --ff-only
  echo "Pull finished. A running app was left alone. Run: make restart"
}

cmd_push() {
  local branch url
  branch="$(git rev-parse --abbrev-ref HEAD)"
  if [[ "$branch" == "HEAD" ]]; then
    echo "This checkout is not on a branch. Check out a branch, then run make push." >&2
    exit 1
  fi
  if git remote get-url github >/dev/null 2>&1; then
    url="$(git remote get-url github)"
    echo "Remote github is ${url}"
  else
    url="https://github.com/ANHVU280598/pokedesk.git"
    echo "Adding remote github → ${url}"
    git remote add github "$url"
  fi
  echo "Pushing ${branch} to github"
  if git push -u github "$branch"; then
    echo "Pushed ${branch} to github."
    return 0
  fi
  echo "GitHub push failed." >&2
  echo "Use a personal access token with repo scope, or run: gh auth login" >&2
  echo "SSH alternative: git remote set-url github git@github.com:ANHVU280598/pokedesk.git" >&2
  exit 1
}

cmd_restart() {
  cmd_stop
  cmd_start
}

menu() {
  cat <<'EOF'
Catalog Desk
  1) Start    API :8765 and UI :43123
  2) Pull     git pull --ff-only of this branch
  3) Restart  stop, then start
  4) Stop
  5) Push     current branch to github (ANHVU280598/pokedesk)
  6) Quit
EOF
  printf "Choose [1-6]: "
  local choice
  read -r choice
  case "$choice" in
    1) cmd_start ;;
    2) cmd_pull ;;
    3) cmd_restart ;;
    4) cmd_stop ;;
    5) cmd_push ;;
    6) exit 0 ;;
    *)
      echo "Unknown choice: ${choice}" >&2
      exit 1
      ;;
  esac
}

usage() {
  echo "Usage: ./scripts/catalog-desk.sh {start|pull|restart|stop|push}" >&2
  echo "With no arguments, an interactive menu runs when stdin is a terminal." >&2
}

case "${1:-}" in
  start) cmd_start ;;
  pull) cmd_pull ;;
  restart) cmd_restart ;;
  stop) cmd_stop ;;
  push) cmd_push ;;
  "")
    if [[ -t 0 ]]; then
      menu
    else
      usage
      exit 1
    fi
    ;;
  -h|--help|help) usage ;;
  *)
    usage
    exit 1
    ;;
esac
