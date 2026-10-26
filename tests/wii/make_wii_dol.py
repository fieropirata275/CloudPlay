"""DOL mínimo que Dolphin arranca en modo Wii: un bucle infinito y una instrucción mtspr HID4 que nunca se
ejecuta (Dolphin la busca para saber que es de Wii).  python3 make_wii_dol.py salida.dol"""
import struct
import sys

h = bytearray(0x100)
struct.pack_into(">I", h, 0x00, 0x100)       # offset de la sección de texto 0
struct.pack_into(">I", h, 0x48, 0x80003100)  # dirección de carga
struct.pack_into(">I", h, 0x90, 0x20)        # tamaño
struct.pack_into(">I", h, 0xE0, 0x80003100)  # punto de entrada
body = struct.pack(">II", 0x48000000, 0x7C13FBA6) + bytes(0x18)  # b . ; mtspr HID4
open(sys.argv[1] if len(sys.argv) > 1 else "wii.dol", "wb").write(bytes(h) + body)
