#!/usr/bin/env bash
# Primer arranque tras instalar desde la ISO (lo lanza cloudplay-firstboot.service).
set -u
ARGS=/etc/cloudplay/firstboot.args
[ -f "$ARGS" ] || exit 0
# Los argumentos llevan tokens: salen de /etc antes de instalar y queda una copia solo-root por si hay que repetir
install -m 600 "$ARGS" /root/.cloudplay-install.args
A=$(cat "$ARGS")
rm -f "$ARGS"
eval set -- "$A"
if bash /opt/cloudplay-src/deploy/install/install.sh "$@" --reboot-ok; then
  rm -f /root/.cloudplay-install.args
fi
