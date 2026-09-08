# NEON BREACH — a compact animated FPS

A single-file, browser-based first-person wave shooter built with Three.js.

## Play

Just open `index.html` in a modern browser (Chrome/Edge/Firefox).
Needs an internet connection the first time (Three.js loads from a CDN).

If your browser blocks pointer-lock on `file://`, serve the folder instead:

```bash
python -m http.server 5178
```

then visit http://localhost:5178

## Controls

| Key | Action |
|-----|--------|
| `W A S D` | Move |
| `Mouse` | Aim |
| `Click` (hold) | Fire (full-auto) |
| `Shift` | Sprint |
| `Space` | Jump |
| `R` | Reload |
| `Esc` | Release cursor |

## Features

- Mouse-look + collision-aware WASD movement, sprint, jump, view-bob
- Full-auto hitscan weapon: animated recoil, muzzle flash + light, tracers, reload animation
- Three enemy types (grunt / fast / heavy) with a procedural walk-cycle animation
  (swinging arms & legs), turn-to-face AI, separation steering, lunge-attack animation,
  hit-flash, and a topple-and-dissolve death animation
- Endless escalating waves, resupply between waves, slow shield recharge
- Particle impact bursts, glowing neon arena, fog, starfield
- Procedural WebAudio SFX (no audio files)
- Start / game-over screens, HUD: health, ammo, score, kills, wave, hit markers, damage vignette

All geometry and audio are generated in code — `index.html` is the only asset.
