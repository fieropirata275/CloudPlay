# Imagen de sesión: Xvfb + PulseAudio + VirtualGL + PCSX2 + Dolphin + streamer GStreamer/WebRTC.
# docker build -t cloudplay/session:latest worker/session
# libhidapi de CloudPlay para Dolphin: los Wiimotes / Balance Boards reales del jugador llegan por sockets
FROM debian:trixie-slim AS hidshim
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev && rm -rf /var/lib/apt/lists/*
COPY hidshim/hidshim.c /src/hidshim.c
COPY hidshim/lanpcap.c /src/lanpcap.c
RUN mkdir -p /out && gcc -O2 -Wall -shared -fPIC -fvisibility=hidden -Wl,-soname,libhidapi-hidraw.so.0 \
      -o /out/libhidapi-hidraw.so.0 /src/hidshim.c \
 # libpcap propia para PCSX2: el adaptador de red de la PS2 va al cable virtual de la sesión (LOCAL LAN MODE)
 && gcc -O2 -Wall -shared -fPIC -fvisibility=hidden -Wl,-soname,libpcap.so.0.8 -o /out/libpcap.so.0.8 /src/lanpcap.c

# Debian trixie: es la distribución que aún empaqueta Dolphin (Ubuntu 24.04 lo quitó y el PPA ya no existe)
FROM debian:trixie-slim

ARG DEBIAN_FRONTEND=noninteractive
# Comprueba las últimas versiones en sus GitHub releases y ajusta si hace falta
ARG PCSX2_URL=https://github.com/PCSX2/pcsx2/releases/download/v2.2.0/pcsx2-v2.2.0-linux-appimage-x64-Qt.AppImage
ARG VGL_URL=https://github.com/VirtualGL/virtualgl/releases/download/3.1.1/virtualgl_3.1.1_amd64.deb

ENV NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=all \
    LANG=C.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl \
      xvfb xdotool x11-utils libxcb-cursor0 libxkbcommon-x11-0 \
      pulseaudio libpulse0 \
      libegl1 libgl1 libglx-mesa0 libgles2 libvulkan1 mesa-va-drivers mesa-vulkan-drivers \
      python3 python3-gi python3-websockets gir1.2-gstreamer-1.0 gir1.2-gst-plugins-base-1.0 gir1.2-gst-plugins-bad-1.0 \
      gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad \
      gstreamer1.0-plugins-ugly gstreamer1.0-nice gstreamer1.0-pulseaudio gstreamer1.0-x \
      libfuse2t64 squashfs-tools util-linux \
 # Dolphin de Debian (trae dolphin-emu-nogui); lo deja en /usr/games
 && apt-get install -y --no-install-recommends dolphin-emu \
 && for b in /usr/games/dolphin-*; do ln -sf "$b" /usr/bin/; done \
 && command -v dolphin-emu-nogui \
 # VirtualGL (backend EGL: OpenGL en la GPU sin servidor X real)
 && curl -fsSL -o /tmp/vgl.deb "$VGL_URL" && apt-get install -y /tmp/vgl.deb && rm /tmp/vgl.deb \
 # PCSX2 AppImage extraída (sin FUSE dentro del contenedor)
 && curl -fsSL -o /tmp/pcsx2.AppImage "$PCSX2_URL" && chmod +x /tmp/pcsx2.AppImage \
 && cd /tmp && ./pcsx2.AppImage --appimage-extract >/dev/null && mv squashfs-root /opt/pcsx2 && rm pcsx2.AppImage \
 && rm -rf /var/lib/apt/lists/*

# Usuario sin privilegios con uid fijo 1000 (el agente hace chown de /saves a 1000)
RUN userdel -r ubuntu 2>/dev/null || true \
 && useradd -m -u 1000 -s /bin/bash player

COPY --from=hidshim /out/libhidapi-hidraw.so.0 /opt/cloudplay/lib/libhidapi-hidraw.so.0
COPY --from=hidshim /out/libpcap.so.0.8 /opt/pcsx2/usr/lib/libpcap.so.0.8
COPY cloudplay /opt/cloudplay
COPY templates /opt/cloudplay/templates
COPY entrypoint.sh setup-emu.sh gc-menu.sh accessories.py pulse.pa /opt/cloudplay/
RUN chmod +x /opt/cloudplay/*.sh

# Comprobación rápida de que los plugins críticos están
RUN gst-inspect-1.0 webrtcbin >/dev/null && gst-inspect-1.0 ximagesrc >/dev/null && gst-inspect-1.0 opusenc >/dev/null

ENTRYPOINT ["/opt/cloudplay/entrypoint.sh"]
