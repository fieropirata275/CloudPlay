#!/usr/bin/env bash
# Prueba completa del puente HID con el Dolphin de verdad (sin hardware): imagen de sesión + Wiimote y
# Balance Board simulados. Dolphin tiene que conectarlos a las ranuras 1 y 5, soltar el Wiimote al
# desvincularlo y volver a cogerlo al vincularlo otra vez.
#   tests/wii/run.sh [imagen]   (por defecto cloudplay/session:local)
set -euo pipefail
IMG="${1:-cloudplay/session:local}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT=$(mktemp -d); chmod 755 "$OUT"; trap 'rm -rf "$OUT"' EXIT
cp "$HERE/fakewiimote.py" "$HERE/bridge_client.py" "$OUT/"
python3 "$HERE/make_wii_dol.py" "$OUT/wii.dol"
chmod a+r "$OUT"/*
cat > "$OUT/run.sh" <<'IN'
set -u
mkdir -p /saves/dolphin/GC /saves/dolphin/Wii /saves/dolphin/StateSaves && chown -R player:player /saves
AS=(setpriv --reuid=1000 --regid=1000 --init-groups env HOME=/home/player)
"${AS[@]}" SESSION_OPTIONS='{"wii_real": true}' /opt/cloudplay/setup-emu.sh
printf '[Options]\nVerbosity = 4\nWriteToConsole = True\n[Logs]\nWIIMOTE = True\n' > /home/player/.dolphin/Config/Logger.ini
Xvfb :7 -screen 0 640x480x24 >/dev/null 2>&1 & sleep 1
"${AS[@]}" python3 /out/bridge_client.py > /tmp/client.log 2>&1 &
sleep 1
"${AS[@]}" DISPLAY=:7 LD_LIBRARY_PATH=/opt/cloudplay/lib CLOUDPLAY_HID_DIR=/tmp/cloudplay-hid \
  timeout 28 dolphin-emu-nogui -u /home/player/.dolphin -p x11 -e /out/wii.dol > /tmp/dol.out 2>&1 || true
sed 's/\x1b\[[0-9;]*m//g' /tmp/dol.out | grep -a "Connected real\|Disconnected real" | cut -c1-100
cat /tmp/client.log
IN
LOG=$(docker run --rm --shm-size=1g -v "$OUT:/out" --entrypoint bash "$IMG" /out/run.sh 2>&1)
echo "$LOG" | grep -v ALSA
c1=$(echo "$LOG" | grep -c "Connected real wiimote to slot 1") || true
c5=$(echo "$LOG" | grep -c "Connected real wiimote to slot 5") || true
if [ "$c1" -ge 2 ] && [ "$c5" -ge 1 ]; then echo "WII_HID_OK"; else echo "WII_HID_FAIL"; exit 1; fi
