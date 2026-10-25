"""Soundtrack for promo/index.html: a 120 BPM track plus sound effects placed on
the animation's cue times. Pure standard library, so it runs anywhere:
    python3 promo/synth.py  ->  promo/audio.wav
"""
import array, math, random, struct, wave, os

SR = 44100
DUR = 30.0
N = int(SR * DUR)
BEAT = 0.5
L = array.array('f', [0.0]) * N   # dry mix
R = array.array('f', [0.0]) * N
VERB = array.array('f', [0.0]) * N  # reverb send (mono)
rng = random.Random(7)
TAU = 2 * math.pi

def add(t, samples, gain=1.0, pan=0.0, verb=0.0):
    i0 = int(t * SR)
    gl = gain * math.cos((pan + 1) * math.pi / 4) * 1.41
    gr = gain * math.sin((pan + 1) * math.pi / 4) * 1.41
    for k, v in enumerate(samples):
        i = i0 + k
        if i >= N: break
        if i < 0: continue
        L[i] += v * gl; R[i] += v * gr
        if verb: VERB[i] += v * gain * verb

def env(n, a, d):
    """Attack (s) then exponential decay with time constant d (s)."""
    na = max(1, int(a * SR))
    for k in range(n):
        yield (k / na) if k < na else math.exp(-(k - na) / (d * SR))

def note(f): return 440 * 2 ** ((f - 69) / 12)

# ---------- instruments ----------
def kick(len_=0.42, punch=1.0):
    n = int(len_ * SR); out = []; ph = 0.0
    for k in range(n):
        x = k / SR
        f = 45 + 110 * math.exp(-x * 28) * punch
        ph += TAU * f / SR
        out.append(math.sin(ph) * math.exp(-x * 7.5) + (0.3 * math.exp(-x * 300) * (rng.random() * 2 - 1)))
    return out

def hat(len_=0.06, bright=1.0):
    n = int(len_ * SR); out = []; prev = 0.0
    for k in range(n):
        w = rng.random() * 2 - 1
        hp = w - prev; prev = w
        out.append(hp * 0.5 * math.exp(-k / SR * 60 / bright))
    return out

def clap():
    n = int(0.25 * SR); out = []; lp = 0.0
    for k in range(n):
        x = k / SR
        bursts = sum(math.exp(-(x - o) * 140) if x >= o else 0 for o in (0, 0.011, 0.022))
        w = rng.random() * 2 - 1
        lp += 0.35 * (w - lp)
        out.append((w - lp) * (bursts * 0.6 + 0.35 * math.exp(-x * 18)))
    return out

def tone(f, len_, a=0.004, d=0.2, shape='sine', vib=0.0):
    n = int(len_ * SR); out = []; ph = 0.0
    for k, e in zip(range(n), env(n, a, d)):
        ph += TAU * f * (1 + vib * math.sin(TAU * 5 * k / SR)) / SR
        if shape == 'sine': v = math.sin(ph)
        elif shape == 'tri': v = 2 / math.pi * math.asin(math.sin(ph))
        elif shape == 'saw': v = sum(math.sin(ph * h) / h for h in range(1, 7)) * 0.6
        else: v = math.sin(ph) + 0.3 * math.sin(2 * ph)
        out.append(v * e)
    return out

def pluck(f, len_=0.35):
    a = tone(f, len_, 0.002, 0.12, 'tri'); b = tone(f * 2, len_, 0.002, 0.05)
    return [x + 0.25 * y for x, y in zip(a, b)]

def bass(f, len_):
    n = int(len_ * SR); out = []; ph = 0.0; lp = 0.0
    for k in range(n):
        ph += TAU * f / SR
        raw = sum(math.sin(ph * h) / h for h in range(1, 8))
        cut = 0.05 + 0.25 * math.exp(-k / SR * 14)
        lp += cut * (raw - lp)
        e = min(1, k / (0.004 * SR)) * (1 - max(0, (k - n + 0.02 * SR) / (0.02 * SR)))
        out.append(lp * e)
    return out

def pad(freqs, len_, a=1.2, rel=1.5):
    n = int(len_ * SR); out = [0.0] * n
    for f in freqs:
        for det in (-0.12, 0.12):
            ph = rng.random() * TAU; ff = f * 2 ** (det / 12)
            for k in range(n):
                ph += TAU * ff / SR
                out[k] += math.sin(ph) + 0.2 * math.sin(2 * ph)
    for k in range(n):
        x = k / SR
        e = min(1, x / a) * min(1, (len_ - x) / rel)
        out[k] *= e * 0.08
    return out

def noise_sweep(len_, f0, f1, rise=True):
    """Filtered noise whoosh; the band moves from f0 to f1."""
    n = int(len_ * SR); out = []; lp1 = lp2 = 0.0
    for k in range(n):
        p = k / n
        f = f0 * (f1 / f0) ** p
        c = min(0.99, TAU * f / SR)
        w = rng.random() * 2 - 1
        lp1 += c * (w - lp1); lp2 += c * (lp1 - lp2)
        shape = math.sin(math.pi * p) ** 1.5 if not rise else p ** 2
        out.append((lp1 - lp2) * shape * 2.2)
    return out

def click(f=3200, len_=0.03):
    n = int(len_ * SR)
    return [(rng.random() * 2 - 1) * 0.5 * math.exp(-k / SR * 260) + math.sin(TAU * f * k / SR) * math.exp(-k / SR * 120) * 0.5 for k in range(n)]

def chime(fs, gap=0.07, d=0.6):
    out = [0.0] * int((gap * len(fs) + d * 4) * SR)
    for i, f in enumerate(fs):
        s = [a + 0.3 * b for a, b in zip(tone(f, d * 4, 0.003, d), tone(f * 3, d * 4, 0.003, d / 4))]
        o = int(i * gap * SR)
        for k, v in enumerate(s):
            if o + k < len(out): out[o + k] += v
    return out

def impact():
    n = int(2.2 * SR); out = []; ph = 0.0; lp = 0.0
    for k in range(n):
        x = k / SR
        ph += TAU * (32 + 70 * math.exp(-x * 6)) / SR
        w = rng.random() * 2 - 1; lp += 0.08 * (w - lp)
        out.append(math.sin(ph) * math.exp(-x * 1.6) + lp * 1.5 * math.exp(-x * 3))
    return out

def glitch(len_):
    n = int(len_ * SR); out = []; v = 0.0
    for k in range(n):
        if k % int(SR / 30) == 0: f = rng.choice([180, 360, 720, 1440, 2880]); on = rng.random() < 0.7
        if k % 6 == 0: v = (math.sin(TAU * f * k / SR) > 0) * 2 - 1
        out.append(v * 0.25 * on)
    return out

def lock_clunk():
    a = click(2100, 0.08); b = tone(3300, 0.12, 0.001, 0.02); c = tone(90, 0.25, 0.002, 0.06)
    m = max(len(a), len(b), len(c))
    pad_ = lambda s: s + [0.0] * (m - len(s))
    return [x + 0.5 * y + 0.9 * z for x, y, z in zip(pad_(a), pad_(b), pad_(c))]

# ---------- arrangement ----------
# A minor: Am | F | C | G, one chord per bar (2 s).
PROG = [(57, [57, 60, 64, 71]), (53, [53, 57, 60, 67]), (48, [55, 60, 64, 67]), (55, [55, 59, 62, 67])]
def chord_at(t):
    return PROG[int(max(0, t - 3) // 2) % 4]

# Intro pad and beacon pings
add(0.0, pad([note(n) for n in (57, 64, 71, 76)], 3.2, 1.6, 0.4), 0.9, verb=0.5)
add(0.1, tone(note(88), 0.8, 0.002, 0.18), 0.22, 0.0, verb=0.6)
for i, t in enumerate((0.5, 1.0, 1.5)):
    add(t, tone(note(81 + [0, 3, 7][i]), 1.0, 0.002, 0.22), 0.26, [-0.4, 0.4, 0][i], verb=0.7)
add(1.9, noise_sweep(0.35, 300, 4000), 0.25)
add(2.0, impact()[: int(0.9 * SR)], 0.35)
add(2.0, chime([note(n) for n in (69, 76, 81, 83)], 0.05, 0.5), 0.2, verb=0.8)
add(2.52, tone(note(100), 0.4, 0.001, 0.05), 0.12, 0.3, verb=0.5)
add(2.3, noise_sweep(0.7, 600, 9000), 0.3)

# Beat 3.0 → 21.75
t = 3.0
while t < 21.99:
    add(t, kick(), 0.85)
    b = round((t - 3) / BEAT)
    if t >= 6.0:
        add(t + 0.25, hat(), 0.35, 0.3)
        if b % 2 == 1: add(t, clap(), 0.5, -0.1, verb=0.25)
    root, ch = chord_at(t)
    for e in (0, 0.25):
        add(t + e, bass(note(root - 24 + (12 if e and b % 4 == 3 else 0)), 0.22), 0.32)
    if t >= 6.0:
        for s in range(2):
            f = note(ch[(b * 2 + s) % 4] + 12)
            add(t + s * 0.25, pluck(f), 0.11, [-0.5, 0.5][s], verb=0.35)
    t += BEAT
for bar in range(int((21.99 - 3) // 2) + 1):
    tb = 3 + bar * 2
    if tb >= 6 and tb < 22:
        add(tb, pad([note(n) for n in chord_at(tb)[1]], 2.1, 0.3, 0.4), 0.55, verb=0.3)

# Cues
for t in (3.0, 3.5, 4.0): add(t, click(1800, 0.05), 0.22)
add(4.55, noise_sweep(0.4, 2000, 6000, False), 0.12, 0.5)
add(5.45, noise_sweep(0.6, 250, 5000, False), 0.4, verb=0.3)
add(5.95, noise_sweep(0.45, 400, 3000, False), 0.25, -0.4)
add(7.35, chime([note(76), note(81)], 0.09, 0.35), 0.24, -0.3, verb=0.6)
for t in (8.5, 9.0, 9.5, 10.0, 10.5, 11.0): add(t, click(2400, 0.04), 0.18)
add(10.6, click(4200, 0.03), 0.4, -0.4)
for i in range(3): add(10.95 + i * 0.25, noise_sweep(0.85, 500 + i * 300, 6000, False), 0.32, -0.6 + 0.6 * i, verb=0.3)
for t, n in ((11.9, 84), (12.35, 88), (12.95, 91)): add(t, tone(note(n), 0.3, 0.002, 0.06), 0.16, 0.5, verb=0.4)
add(13.0, chime([note(n) for n in (76, 81, 85, 88)], 0.06, 0.5), 0.22, verb=0.7)
add(14.45, noise_sweep(0.55, 300, 4000, False), 0.3, verb=0.2)
add(15.2, chime([note(83), note(88)], 0.12, 0.45), 0.28, 0.5, verb=0.5)
add(16.3, click(5200, 0.025), 0.45, 0.2)
add(16.55, noise_sweep(0.3, 800, 5000, False), 0.15)
add(16.8, tone(note(91), 0.3, 0.002, 0.07), 0.15, verb=0.4)
add(17.8, noise_sweep(0.5, 200, 3500, False), 0.38, verb=0.3)
add(18.2, tone(note(45), 0.6, 0.003, 0.15, 'saw'), 0.25)
add(18.75, glitch(0.65), 0.35)
add(19.45, noise_sweep(0.25, 1000, 300, False), 0.2)
add(19.75, lock_clunk(), 0.6, verb=0.4)
for i in range(5): add(19.6 + i * 0.06, click(1400 + 200 * i, 0.03), 0.08, -0.6 + 0.3 * i)
add(20.42, kick(0.3, 0.6), 0.5); add(20.45, click(1600, 0.06), 0.3, verb=0.3)
add(21.0, tone(note(88), 0.3, 0.002, 0.08), 0.12, verb=0.4)
add(21.3, noise_sweep(0.7, 400, 10000), 0.35)

# Feature hits 22.0–24.5: stab chords climbing.
STABS = [57, 53, 60, 55, 62, 64]
for i, t in enumerate((22.0, 22.5, 23.0, 23.5, 24.0, 24.5)):
    add(t, kick(0.35, 1.3), 0.9)
    add(t, clap(), 0.35, verb=0.3)
    r = STABS[i]
    for n in (r, r + 4 if i % 2 else r + 3, r + 7, r + 12):
        add(t, tone(note(n), 0.4, 0.002, 0.09, 'saw'), 0.06, (n % 3 - 1) * 0.4, verb=0.4)
    add(t, noise_sweep(0.28, 600, 7000, False), 0.15)
add(24.55, noise_sweep(0.45, 300, 12000), 0.4)

# End card: impact, logo bloom, held A major add9 chord, soft pings on the rings.
add(25.0, impact(), 0.75, verb=0.4)
add(25.15, chime([note(n) for n in (69, 76, 81, 83, 88)], 0.05, 0.7), 0.24, verb=0.9)
add(25.0, pad([note(n) for n in (45, 57, 61, 64, 71, 76)], 5.0, 0.25, 2.0), 1.0, verb=0.6)
for t in (26.0, 27.0, 28.0):
    add(t, tone(note(81), 1.0, 0.002, 0.25), 0.1, 0.0, verb=0.8)
add(26.6, tone(note(88), 0.6, 0.002, 0.12), 0.1, 0.4, verb=0.6)

# ---------- reverb (Schroeder) ----------
def comb(x, d, g):
    y = array.array('f', [0.0]) * len(x)
    for i in range(len(x)):
        y[i] = x[i] + (g * y[i - d] if i >= d else 0)
    return y
def allpass(x, d, g):
    y = array.array('f', [0.0]) * len(x)
    for i in range(len(x)):
        xd = x[i - d] if i >= d else 0; yd = y[i - d] if i >= d else 0
        y[i] = -g * x[i] + xd + g * yd
    return y
wetL = array.array('f', [0.0]) * N; wetR = array.array('f', [0.0]) * N
for d, g in ((1557, 0.82), (1617, 0.81), (1491, 0.8), (1422, 0.79)):
    c = comb(VERB, d, g)
    for i in range(N): wetL[i] += c[i] * 0.25
for d, g in ((1617 + 23, 0.82), (1557 + 23, 0.81), (1491 + 23, 0.8), (1422 + 23, 0.79)):
    c = comb(VERB, d, g)
    for i in range(N): wetR[i] += c[i] * 0.25
wetL = allpass(allpass(wetL, 225, 0.5), 556, 0.5)
wetR = allpass(allpass(wetR, 248, 0.5), 579, 0.5)

# ---------- master: mix, soft clip, fade, write ----------
peak = 1e-9
for i in range(N):
    L[i] += wetL[i] * 0.35; R[i] += wetR[i] * 0.35
    peak = max(peak, abs(L[i]), abs(R[i]))
gain = 1.6 / peak
out = bytearray()
fade0 = int(29.0 * SR)
for i in range(N):
    f = 1.0 if i < fade0 else max(0.0, 1 - (i - fade0) / (N - fade0))
    l = math.tanh(L[i] * gain) * 0.89 * f
    r = math.tanh(R[i] * gain) * 0.89 * f
    out += struct.pack('<hh', int(l * 32767), int(r * 32767))
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'audio.wav')
with wave.open(path, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(bytes(out))
print('wrote', path)
