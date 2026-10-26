# Imagen de sesión: Xvfb + PulseAudio + VirtualGL + PCSX2 + Dolphin + streamer GStreamer/WebRTC.
# docker build -t cloudplay/session:latest worker/session
FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive
# Comprueba las últimas versiones en sus GitHub releases y ajusta si hace falta
ARG PCSX2_URL=https://github.com/PCSX2/pcsx2/releases/download/v2.2.0/pcsx2-v2.2.0-linux-appimage-x64-Qt.AppImage
ARG VGL_URL=https://github.com/VirtualGL/virtualgl/releases/download/3.1.1/virtualgl_3.1.1_amd64.deb

ENV NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=all \
    LANG=C.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl software-properties-common gpg-agent \
      xvfb xdotool x11-utils libxcb-cursor0 libxkbcommon-x11-0 \
      pulseaudio libpulse0 \
      libegl1 libgl1 libglx-mesa0 libgles2 libvulkan1 mesa-va-drivers mesa-vulkan-drivers \
      python3 python3-gi python3-websockets gir1.2-gstreamer-1.0 gir1.2-gst-plugins-base-1.0 gir1.2-gst-plugins-bad-1.0 \
      gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad \
      gstreamer1.0-plugins-ugly gstreamer1.0-nice gstreamer1.0-pulseaudio gstreamer1.0-x \
      libfuse2 squashfs-tools util-linux \
 # Dolphin del repositorio universe de Ubuntu (el PPA oficial ya no existe); Debian lo deja en /usr/games
 && add-apt-repository -y universe \
 && apt-get update && apt-get install -y --no-install-recommends dolphin-emu \
 && for b in /usr/games/dolphin-*; do ln -sf "$b" /usr/bin/; done \
 && command -v dolphin-emu-nogui \
 # VirtualGL (backend EGL: OpenGL en la GPU sin servidor X real)
 && curl -fsSL -o /tmp/vgl.deb "$VGL_URL" && apt-get install -y /tmp/vgl.deb && rm /tmp/vgl.deb \
 # PCSX2 AppImage extraída (sin FUSE dentro del contenedor)
 && curl -fsSL -o /tmp/pcsx2.AppImage "$PCSX2_URL" && chmod +x /tmp/pcsx2.AppImage \
 && cd /tmp && ./pcsx2.AppImage --appimage-extract >/dev/null && mv squashfs-root /opt/pcsx2 && rm pcsx2.AppImage \
 && apt-get purge -y software-properties-common gpg-agent && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

# Usuario sin privilegios con uid fijo 1000 (el agente hace chown de /saves a 1000)
RUN userdel -r ubuntu 2>/dev/null || true \
 && useradd -m -u 1000 -s /bin/bash player

COPY cloudplay /opt/cloudplay
COPY templates /opt/cloudplay/templates
COPY entrypoint.sh setup-emu.sh pulse.pa /opt/cloudplay/
RUN chmod +x /opt/cloudplay/*.sh

# Comprobación rápida de que los plugins críticos están
RUN gst-inspect-1.0 webrtcbin >/dev/null && gst-inspect-1.0 ximagesrc >/dev/null && gst-inspect-1.0 opusenc >/dev/null

ENTRYPOINT ["/opt/cloudplay/entrypoint.sh"]
