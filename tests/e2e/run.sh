#!/usr/bin/env bash
# E2E completo SIN Docker ni GPU: control plane (SQLite+fakeredis) + agente simulado que lanza
# el session.py REAL (patrón de vídeo en vez de emulador, mando falso en vez de uinput)
# + Chromium headless jugando vía WebRTC con el cliente web real.
#
# Requisitos (Debian/Ubuntu):
#   apt install xvfb xdotool gstreamer1.0-tools gstreamer1.0-plugins-{base,good,bad,ugly} gstreamer1.0-nice \
#               gstreamer1.0-libav gir1.2-gst-plugins-bad-1.0 python3-gi
#   pip install -r ../../control-plane/requirements.txt aiosqlite fakeredis websockets playwright
#   python -m playwright install chromium
#   GST_PYTHON=/usr/bin/python3  (el python que tiene 'gi' + 'websockets')
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PORT=8077
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; pkill -f "ximagesink display=:99" 2>/dev/null || true; }
trap cleanup EXIT
# Restos de una ejecución anterior que no llegó a limpiar (sesión de prueba o servidor colgados)
pkill -f "[r]un_session.py" 2>/dev/null || true
pkill -f "[d]evserver.py $PORT" 2>/dev/null || true

# Comprueba que el display responde (un socket huérfano no basta)
if ! DISPLAY=:99 xdotool getdisplaygeometry >/dev/null 2>&1; then
  rm -f /tmp/.X11-unix/X99 /tmp/.X99-lock
  Xvfb :99 -screen 0 1280x720x24 -nolisten tcp & PIDS+=($!); sleep 1
fi

# Si una ejecución anterior aún está cerrando su servidor, se le dan unos segundos
for _ in $(seq 1 20); do curl -sf "localhost:$PORT/api/health" >/dev/null 2>&1 || break; sleep 0.5; done
if curl -sf "localhost:$PORT/api/health" >/dev/null 2>&1; then echo "El puerto $PORT ya está en uso"; exit 1; fi
cd "$HERE/../../control-plane"
rm -f dev.db
CP_STUN_URLS="" CP_TURN_URLS="" python3 devserver.py "$PORT" > "$HERE/dev.log" 2>&1 & PIDS+=($!)
for _ in $(seq 1 30); do curl -sf "localhost:$PORT/api/health" >/dev/null && break; sleep 0.3; done

TOK=$(curl -s -X POST "localhost:$PORT/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"admin@local","password":"devpassword"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
NODE=$(curl -s -X POST "localhost:$PORT/api/admin/nodes" -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d '{"name":"e2e","capacity":2}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

rm -f "$HERE/pad.log"
cd "$HERE"
DISPLAY=:99 python3 fake_agent.py "$NODE" > agent.log 2>&1 & PIDS+=($!)
sleep 1.5
if [ "${E2E_DESKTOP:-0}" = 1 ]; then
  (cd ../../clients/desktop && CLOUDPLAY_SERVER="http://localhost:$PORT" npm run -s web)
  NODE_PATH="$(npm root -g)" DISPLAY=:99 node desktop.js
elif [ "${E2E_ACC:-0}" = 1 ]; then
  python3 accessories.py
  grep -h "opciones de la sesión" agent.log || true
elif [ "${E2E_MEDIA:-0}" = 1 ]; then
  python3 media.py
  grep -h "opciones de la sesión" agent.log || true
elif [ "${E2E_WII:-0}" = 1 ]; then
  rm -f wii_hid.json
  python3 wii_hid.py
  grep -h "opciones de la sesión" agent.log || true
else
  python3 play.py
fi
echo "Estados de mando distintos recibidos por el worker:"; sort -u pad.log | head
