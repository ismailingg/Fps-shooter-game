# NEON BREACH — co-op wave FPS

A single-file browser FPS (Three.js) with an optional Node **co-op server** so
friends on your network can drop into the same match.

## Play solo (no server)

Open `index.html` in a modern browser. It detects there's no server and runs
**SOLO** mode — full offline game, local waves, shield recharge.
(Needs internet once, to pull Three.js from a CDN.)

## Play co-op

```bash
npm install      # one time — installs 'ws'
npm start        # or: node server.js
```

The server prints a **Local** and a **Network** URL, e.g.:

```
  Local:   http://localhost:5178
  Network: http://192.168.1.42:5178   <- share this with players on your Wi-Fi
```

Everyone opens that URL, types a **callsign**, and hits **ENGAGE**. The start
screen shows `ONLINE — co-op server connected` when it's linked up.

- The server owns the enemies, waves and score — all players fight one shared swarm.
- You see other players as cyan constructs with floating nameplates, moving and shooting live.
- Downed players get a personal **YOU ARE DOWN** screen and can **REDEPLOY** into the
  match in progress. If everyone is down, the grid resets after a few seconds.
- Between waves the squad gets a partial heal.

### Hosting for players outside your LAN

`server.js` is a plain HTTP + WebSocket server on one port. Put it behind any
tunnel (e.g. `ngrok http 5178`, a Cloudflare tunnel, or a cloud VM) and share
that URL. Set `PORT` via env var if 5178 is taken.

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

## Files

| File | Purpose |
|------|---------|
| `index.html` | The whole game — rendering, input, FX, netcode client, offline fallback |
| `server.js`  | HTTP static host + authoritative co-op WebSocket server |
| `package.json` | Declares the one dependency (`ws`) and `npm start` |

All geometry and audio are generated in code — there are no image or sound assets.

## Enemies

| Type | Colour | Traits |
|------|--------|--------|
| Grunt | violet | baseline |
| Fast  | amber  | small, quick, fragile |
| Heavy | red    | big, slow, tanky, hits hard |

Waves scale with count and with the number of players connected.
