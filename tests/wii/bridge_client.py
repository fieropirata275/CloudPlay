# El "jugador": un Wiimote y una Balance Board simulados detrás del puente HID real de la sesión.
import sys, threading, time
sys.path.insert(0, "/opt"); sys.path.insert(0, "/out")
from cloudplay.hidbridge import HidBridge, LINK, UNLINK, REPORT, STATE
from fakewiimote import FakeWiimote

devs = {0: FakeWiimote(False), 1: FakeWiimote(True)}
states = []
bridge = None

def to_client(msg: bytes):  # lo que la nube manda al navegador
    t, dev_id = msg[0], msg[1]
    if t == STATE:
        states.append((dev_id, msg[2])); print(f"cliente: estado {dev_id} -> {msg[2]}", flush=True)
    elif t == REPORT:
        for r in devs[dev_id].handle(msg[2:]):
            bridge.on_message(bytes([REPORT, dev_id]) + r)

bridge = HidBridge("/tmp/cloudplay-hid", to_client)
bridge.on_message(bytes([LINK, 0, 0]))
bridge.on_message(bytes([LINK, 1, 1]))

def pump():
    while True:
        time.sleep(0.01)
        for i, d in devs.items():
            if i in bridge.devices:
                bridge.on_message(bytes([REPORT, i]) + d.periodic())
threading.Thread(target=pump, daemon=True).start()

time.sleep(12)
print("cliente: desvinculo el Wiimote", flush=True)
bridge.on_message(bytes([UNLINK, 0]))
time.sleep(4)
print("cliente: lo vuelvo a vincular", flush=True)
bridge.on_message(bytes([LINK, 0, 0]))
time.sleep(8)
print("cliente: estados recibidos", states, "· informes vistos por el Wiimote:", sorted({hex(x) for x in devs[0].log}), flush=True)
