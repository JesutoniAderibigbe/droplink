# DropLink ad

A 30-second, 1920×1080, 60 fps motion-graphics ad for DropLink, written as code.

- `index.html`: the animation. Every frame is a pure function of time (`seek(t)`), with closed-form
  springs and no CSS transitions or timers, so it renders identically frame by frame. Open it in a
  browser (via any static server) to play it with sound and scrub through it.
- `synth.py`: the soundtrack (120 BPM, A minor) and every sound effect, synthesized with the Python
  standard library and placed on the animation's cue times. Writes `audio.wav`.
- `render.mjs`: renders the page with headless Chromium and pipes the frames to ffmpeg.

```bash
python3 promo/synth.py                      # audio.wav
node promo/render.mjs                       # out/video.mp4 (silent)
ffmpeg -i promo/out/video.mp4 -i promo/audio.wav -c:v copy -c:a aac -b:a 256k \
  -shortest -movflags +faststart promo/out/DropLink-ad.mp4
node promo/render.mjs --stills 2.8,11.4,26.4  # check single frames
```

## Storyboard (one beat = 0.5 s)

| Time | Scene |
| --- | --- |
| 0–3 s | A dot pulses in the dark, blooms into the logo, the wordmark wipes in. |
| 3–6 s | "Your phone. Your laptop. One account." on the downbeats. |
| 6–10 s | Light canvas: phone and laptop rise in; the radar finds the MacBook. "No pairing. No cables. No codes." |
| 10–14.5 s | "Pick. Tap. Beam." Three files ride an arc to the laptop; progress fills; "Everything arrived." |
| 14.5–18 s | Laptop asleep: a notification nudges, the cursor clicks, files are there. |
| 18–22 s | "Nobody home? It waits, locked." The file scrambles, a padlock snaps shut, it goes into a locker. |
| 22–25 s | Six feature cards, one per beat. |
| 25–30 s | Logo, wordmark, tagline, URL. |
