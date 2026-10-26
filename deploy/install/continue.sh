#!/usr/bin/env bash
# Sigue la instalación tras el reinicio que pide el driver de NVIDIA (cloudplay-continue.service).
set -u
systemctl disable cloudplay-continue >/dev/null 2>&1
eval set -- "$(cat /etc/cloudplay/install.args)"
exec bash /opt/cloudplay/deploy/install/install.sh "$@" --reboot-ok
