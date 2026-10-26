#!/usr/bin/env bash
# Arranca el menú principal de GameCube (la IPL de la consola) sin juego.
# Dolphin sin interfaz solo arranca ficheros o títulos de la NAND; la IPL sola se arranca desde la versión Qt:
# Herramientas → Cargar menú principal de GameCube → región. Se pulsa con xdotool (pantalla y fuente fijas en
# la imagen) y luego la ventana de juego se pone a pantalla completa y la principal se oculta.
set -uo pipefail
USER_DIR="${1:-$HOME/.dolphin}"
QT_BIN="${DOLPHIN_QT_REAL:-dolphin-emu}"

# Región: la que pida GC_IPL_REGION o la primera IPL que haya (EUR → PAL, USA → NTSC-U, JAP → NTSC-J)
region="${GC_IPL_REGION:-}"
if [ -z "$region" ]; then
  for r in EUR USA JAP; do [ -f "$USER_DIR/GC/$r/IPL.bin" ] && { region=$r; break; }; done
fi
case "$region" in
  JAP) y=189 ;; USA) y=211 ;; EUR) y=233 ;;
  *) echo "gc-menu: no hay IPL de GameCube en /bios/gc/{EUR,USA,JAP}/IPL.bin" >&2; exit 2 ;;
esac

"$QT_BIN" -u "$USER_DIR" -C Dolphin.Display.Fullscreen=True -C Dolphin.Display.RenderToMain=False &
pid=$!
# Al parar la sesión: cierre limpio de Dolphin (vuelca la tarjeta de memoria); si se cuelga, a los 8 s se fuerza
trap 'kill -TERM $pid 2>/dev/null; for _ in $(seq 1 32); do kill -0 $pid 2>/dev/null || exit 0; sleep 0.25; done; kill -KILL $pid; exit 0' TERM INT

main=""
for _ in $(seq 1 80); do
  main=$(xdotool search --onlyvisible --name '^Dolphin' 2>/dev/null | head -1)
  [ -n "$main" ] && break
  kill -0 $pid 2>/dev/null || exit 1
  sleep 0.25
done
[ -n "$main" ] || { echo "gc-menu: la ventana de Dolphin no aparece" >&2; kill $pid; exit 1; }
sleep 1.5
xdotool windowmove "$main" 0 0
# Herramientas (menú) → "Load GameCube Main Menu" → región
xdotool mousemove 245 8 click 1; sleep 0.8
xdotool mousemove 330 189; sleep 0.8
xdotool mousemove 520 189; sleep 0.3
xdotool mousemove 520 "$y" click 1

render=""
for _ in $(seq 1 60); do
  # La ventana de juego es otra ventana "Dolphin..." visible, distinta de la principal
  render=$(xdotool search --onlyvisible --name '^Dolphin' 2>/dev/null | grep -vx "$main" | head -1)
  [ -n "$render" ] && break
  sleep 0.25
done
if [ -n "$render" ]; then
  read -r W H < <(xdpyinfo 2>/dev/null | awk '/dimensions:/{split($2,a,"x"); print a[1], a[2]}')
  xdotool windowunmap "$main"
  xdotool windowmove "$render" 0 0 windowsize "$render" "${W:-1280}" "${H:-720}" windowraise "$render" windowfocus "$render"
  xdotool mousemove "${W:-1280}" "${H:-720}"
else
  echo "gc-menu: Dolphin no ha arrancado la IPL" >&2
fi
wait $pid
