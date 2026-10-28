#!/usr/bin/env python3
"""Sonido de arranque de CloudPlay, sintetizado (sin muestras de nadie): jingle.py <ps2|gc|wii> <segundos> <salida.wav>

Va sincronizado con splash.html: encendido (0 s), acorde que crece mientras gira el logo, campanada cuando se
enciende el "play" (1,9 s), chispas cuando el logo se deshace (3,05 s), acorde final al formarse la consola (3,8 s)
y un soplido cuando todo sale hacia la pantalla (4,6 s). Cada consola en su tono.
"""
import sys
import wave

import numpy as np

SR = 48000
platform, dur, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
SHIFT = {"ps2": 0, "gc": 3, "wii": 7}.get(platform, 0)
rng = np.random.default_rng(7 + SHIFT)
n = int(SR * dur)
t = np.arange(n) / SR
L = np.zeros(n)
R = np.zeros(n)


def hz(semi):  # semitonos desde La 220 (más el tono de la consola)
    return 220.0 * 2 ** ((semi + SHIFT) / 12)


def env(start, attack, decay, length=None):
    e = np.zeros(n)
    i0 = int(start * SR)
    m = n - i0 if length is None else min(n - i0, int(length * SR))
    if m <= 0:
        return e
    x = np.arange(m) / SR
    e[i0:i0 + m] = np.minimum(1, x / max(attack, 1e-4)) * np.exp(-np.maximum(0, x - attack) / decay)
    return e


def add(sig, pan=0.0, gain=1.0):
    global L, R
    L += sig * gain * np.sqrt((1 - pan) / 2)
    R += sig * gain * np.sqrt((1 + pan) / 2)


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):  # un polo; suficiente para suavizar ruido
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


# 1) encendido: golpe grave + clic
thump = np.sin(2 * np.pi * (42 + 30 * np.exp(-t * 18)) * t) * env(0.02, 0.004, 0.35)
add(thump, gain=0.55)
click = rng.standard_normal(n) * env(0.02, 0.0005, 0.012)
add(click, gain=0.15)

# 2) acorde que crece (cuerdas sintéticas desafinadas), sube hasta la campanada
swell = np.clip((t - 0.3) / 1.6, 0, 1) ** 2 * np.exp(-np.maximum(0, t - 2.0) / 1.2)
for k, semi in enumerate([-12, -5, 2, 7, 11]):
    for det, pan in ((-0.12, -0.6), (0.12, 0.6)):
        f = hz(semi + det)
        ph = 2 * np.pi * f * t + rng.uniform(0, 6.28)
        wave_ = np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.15 * np.sin(3 * ph)
        add(wave_ * swell * (0.5 + 0.5 * np.sin(2 * np.pi * 0.3 * t + k)), pan, 0.045)

# 3) campanada metálica (parciales inarmónicas) cuando se enciende el play
for start, base, pan in ((1.9, 24, -0.15), (1.97, 31, 0.2)):
    for ratio, amp, dec in ((1.0, 1.0, 1.4), (2.76, 0.5, 0.8), (5.4, 0.25, 0.45), (8.9, 0.12, 0.25)):
        add(np.sin(2 * np.pi * hz(base) * ratio * t) * env(start, 0.003, dec), pan, 0.09 * amp)

# 4) chispas mientras el logo se deshace
for i in range(70):
    st = 3.05 + rng.uniform(0, 0.9)
    f = hz(rng.choice([24, 26, 31, 33, 36, 38, 43]))
    add(np.sin(2 * np.pi * f * t) * env(st, 0.002, rng.uniform(0.05, 0.18)), rng.uniform(-0.9, 0.9), 0.035)

# 5) acorde final cuando las partículas forman la consola
for semi, pan in ((0, -0.3), (7, 0.3), (12, 0), (16, -0.2), (19, 0.2)):
    ph = 2 * np.pi * hz(semi) * t
    add((np.sin(ph) + 0.2 * np.sin(2 * ph)) * env(3.8, 0.12, 0.9), pan, 0.07)

# 6) soplido final hacia la pantalla
noise = lowpass(rng.standard_normal(n), 2400)
add(noise * env(4.45, 0.35, 0.35) * 1.0, -0.2, 0.18)
add(noise[::-1] * env(4.45, 0.35, 0.35), 0.2, 0.18)

# reverb barata: unos cuantos ecos decrecientes
for d, g in ((0.031, 0.32), (0.047, 0.27), (0.071, 0.22), (0.113, 0.16), (0.173, 0.11)):
    k = int(d * SR)
    L[k:] += g * R[:-k]
    R[k:] += g * L[:-k]

fade = np.clip((dur - t) / 0.25, 0, 1)
mix = np.stack([L * fade, R * fade], axis=1)
mix /= max(1e-6, np.abs(mix).max()) / 0.85
pcm = (mix * 32767).astype("<i2")
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
