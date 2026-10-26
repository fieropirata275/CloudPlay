#!/usr/bin/env bash
# Arranque del contenedor de sesión. Corre como root lo mínimo imprescindible.
set -euo pipefail

: "${DISPLAY_NUM:=100}"
: "${RESOLUTION:=1280x720}"
RUN_AS=(setpriv --reuid=1000 --regid=1000 --init-groups)
RUNTIME=/run/user/1000
export DISPLAY=":${DISPLAY_NUM}" XDG_RUNTIME_DIR="$RUNTIME" HOME=/home/player

mkdir -p "$RUNTIME" /dev/input /tmp/.X11-unix
chown player:player "$RUNTIME" && chmod 700 "$RUNTIME"
chmod 1777 /tmp/.X11-unix

# Partidas: el agente monta /saves (sincronizado con el S3 de partidas)
mkdir -p /saves/ps2/memcards /saves/ps2/sstates /saves/dolphin/GC /saves/dolphin/Wii /saves/dolphin/StateSaves
chown -R player:player /saves

# Configs de los emuladores generadas desde plantillas
"${RUN_AS[@]}" env HOME=/home/player /opt/cloudplay/setup-emu.sh

# Display virtual (sin TCP ni socket abstracto: compartimos netns del host)
"${RUN_AS[@]}" Xvfb "$DISPLAY" -screen 0 "${RESOLUTION}x24" -nolisten tcp -nolisten local -noreset -dpi 96 &
for _ in $(seq 1 50); do [ -S "/tmp/.X11-unix/X${DISPLAY_NUM}" ] && break; sleep 0.1; done

# Audio: null sink, el streamer captura su monitor
"${RUN_AS[@]}" env XDG_RUNTIME_DIR="$RUNTIME" HOME=/home/player \
  pulseaudio --daemonize=yes --exit-idle-time=-1 --disallow-exit -n -F /opt/cloudplay/pulse.pa --log-target=stderr
for _ in $(seq 1 50); do [ -S "$RUNTIME/pulse/native" ] && break; sleep 0.1; done
export PULSE_SERVER="unix:$RUNTIME/pulse/native"

# session.py crea los mandos como root y baja a uid 1000 antes de tocar la red
cd /opt && exec python3 -m cloudplay.session
