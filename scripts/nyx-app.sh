#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Nyx Reader desktop launcher.
#
# Starts the Vite dev server (needed for the Wisdom proxy) if it is not already
# running, then opens the app in a chrome-less Chromium window so it behaves
# like a normal desktop app. Closing the window stops the server again — but
# only if this script was the thing that started it.
#
# Installed as ~/.local/share/applications/nyx-reader.desktop
# Log: /tmp/nyx-reader.log
# ---------------------------------------------------------------------------
set -uo pipefail

APP_DIR="/home/qomusiy/Documents/nyx reader"
LOG="/tmp/nyx-reader.log"
DEV_LOG="/tmp/nyx-reader-dev.log"
PID_FILE="/tmp/nyx-reader.pid"

exec 2> >(tee -a "$LOG" >&2)
echo "--- launch $(date '+%F %T') ---" >> "$LOG"

# --- node --------------------------------------------------------------------
# Two traps here. A desktop launcher gets a minimal PATH, so nvm's node is
# missing; and /usr/bin/node is Node 18, too old for Vite (needs ^20.19 || >=22.12).
# So test the VERSION, not just that some node exists.
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local v major
  v=$(node -v 2>/dev/null) || return 1
  v=${v#v}; major=${v%%.*}
  [ -n "$major" ] && [ "$major" -ge 20 ] 2>/dev/null
}

if ! node_ok; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
    nvm use --silent default >/dev/null 2>&1
  fi
fi

if ! node_ok; then
  # Last resort: newest node nvm has on disk, put ahead of the system one.
  newest=$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)
  [ -n "$newest" ] && export PATH="$newest:$PATH"
fi

if ! node_ok; then
  msg="Need Node 20+; found $(command -v node >/dev/null 2>&1 && node -v || echo none)."
  notify-send -i dialog-error "Nyx Reader" "$msg See $LOG" 2>/dev/null
  echo "FATAL: $msg" >> "$LOG"
  exit 1
fi
echo "node $(node -v) at $(command -v node)" >> "$LOG"

cd "$APP_DIR" || { echo "FATAL: $APP_DIR missing" >> "$LOG"; exit 1; }

# --- reuse a server that is already up, otherwise start one -----------------
url_from_log() { grep -oE 'http://localhost:[0-9]+' "$DEV_LOG" 2>/dev/null | head -1; }

URL=""
STARTED_SERVER=0

for port in 5173 5174 5175; do
  if curl -sf -o /dev/null --max-time 1 "http://localhost:$port/"; then
    URL="http://localhost:$port"
    echo "reusing server at $URL" >> "$LOG"
    break
  fi
done

if [ -z "$URL" ]; then
  : > "$DEV_LOG"
  rm -f "$PID_FILE"
  # Run in its own session so the whole tree (npm -> sh -> node) can be stopped
  # as one process group. Killing just the npm wrapper leaves vite orphaned.
  setsid bash -c 'echo $$ > "'"$PID_FILE"'"; exec npm run dev' >>"$DEV_LOG" 2>&1 &
  STARTED_SERVER=1

  DEV_PGID=""
  for _ in $(seq 1 40); do
    [ -s "$PID_FILE" ] && { DEV_PGID=$(cat "$PID_FILE"); break; }
    sleep 0.1
  done
  echo "started dev server pgid=${DEV_PGID:-unknown}" >> "$LOG"

  for _ in $(seq 1 60); do          # up to ~30s
    URL=$(url_from_log)
    if [ -n "$URL" ] && curl -sf -o /dev/null --max-time 1 "$URL/"; then break; fi
    [ -n "$DEV_PGID" ] && { kill -0 "$DEV_PGID" 2>/dev/null || { echo "FATAL: dev server died" >> "$LOG"; break; }; }
    sleep 0.5
    URL=""
  done
fi

if [ -z "$URL" ]; then
  notify-send -i dialog-error "Nyx Reader" "Dev server did not start. See $DEV_LOG" 2>/dev/null
  echo "FATAL: no URL after wait" >> "$LOG"
  exit 1
fi

cleanup() {
  if [ "$STARTED_SERVER" = 1 ] && [ -n "${DEV_PGID:-}" ]; then
    echo "stopping dev server group $DEV_PGID" >> "$LOG"
    kill -TERM -"$DEV_PGID" 2>/dev/null      # negative PID = whole process group
    for _ in $(seq 1 20); do
      kill -0 -"$DEV_PGID" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL -"$DEV_PGID" 2>/dev/null
    rm -f "$PID_FILE"
  fi
}
trap cleanup EXIT INT TERM

# --- open it like an app ----------------------------------------------------
# --app strips the address bar and tabs; --class sets WM_CLASS so GNOME shows
# the right icon in the dock (matched by StartupWMClass in the .desktop file).
if command -v chromium >/dev/null 2>&1; then
  echo "opening chromium --app=$URL" >> "$LOG"
  chromium --app="$URL" --class=NyxReader --window-size=1400,900 >>"$LOG" 2>&1
else
  echo "chromium missing; falling back to default browser" >> "$LOG"
  xdg-open "$URL" >>"$LOG" 2>&1
  # A normal browser tab cannot be waited on, so leave the server running and
  # let the user close it from the terminal or by logging out.
  trap - EXIT INT TERM
  notify-send -i info "Nyx Reader" "Opened in your browser. Server keeps running at $URL" 2>/dev/null
fi
