/* ============================================================================
   NEON BREACH — co-op server
   - Serves the static client (index.html) over HTTP
   - Authoritative WebSocket game server: owns enemies, waves, and score
   Run:  node server.js       (or: npm start)
   ========================================================================== */
"use strict";

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 5178;
const ROOT = __dirname;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------
const httpServer = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
});

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const ARENA = 46;
const TICK_HZ = 33;
const SNAP_HZ = 20;

let nextPlayerId = 1;
let nextEnemyId = 1;

/** id -> { ws, id, name, x, y, z, ry, rx, hp, score, kills, alive, moving } */
const players = new Map();
/** id -> { id, x, z, yaw, kind, hp, maxHp, speed, dead, dying, attackCd, state } */
const enemies = new Map();

let wave = 0;
let spawnQueue = 0;
let spawnTimer = 0;
let betweenWaves = 0;
let clearAnnounced = false;
let score = 0;
let kills = 0;
let resetTimer = 0;

function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const p of players.values()) {
    if (p.ws.readyState === 1) { try { p.ws.send(s); } catch (_) {} }
  }
}

function kindStats(kind) {
  if (kind === "heavy") return { hp: 9, speed: 1.7, scale: 1.5, dmg: 18, pts: 150 };
  if (kind === "fast") return { hp: 2, speed: 5.2, scale: 0.8, dmg: 7, pts: 90 };
  return { hp: 4, speed: 3.1, scale: 1.0, dmg: 11, pts: 60 };
}

function startWave(n) {
  wave = n;
  spawnQueue = 4 + n * 2 + Math.max(0, activeCount() - 1) * 3;
  spawnTimer = n === 1 ? 4.0 : 1.0; // grace before the first hostiles of a run
  betweenWaves = 0;
  clearAnnounced = false;
  broadcast({ t: "announce", text: "WAVE " + n });
}

function activeCount() {
  let c = 0;
  for (const p of players.values()) if (p.inGame && p.alive) c++;
  return c;
}

function spawnEnemy() {
  const r = Math.random();
  let kind = "grunt";
  if (wave >= 3 && r < 0.18) kind = "heavy";
  else if (wave >= 2 && r < 0.5) kind = "fast";
  const st = kindStats(kind);
  const a = Math.random() * Math.PI * 2;
  const rad = ARENA - 4;
  const id = nextEnemyId++;
  enemies.set(id, {
    id, x: Math.cos(a) * rad, z: Math.sin(a) * rad, yaw: 0,
    kind, hp: st.hp, maxHp: st.hp, speed: st.speed,
    dead: false, dying: 0, attackCd: 0, state: "walk",
  });
}

function anyPlayersActive() {
  for (const p of players.values()) if (p.alive && p.inGame) return true;
  return false;
}
function anyPlayersInGame() {
  for (const p of players.values()) if (p.inGame) return true;
  return false;
}

function fullReset() {
  enemies.clear();
  wave = 0; spawnQueue = 0; spawnTimer = 0; betweenWaves = 0;
  score = 0; kills = 0; resetTimer = 0;
  for (const p of players.values()) { p.hp = 100; p.alive = true; p.score = 0; p.kills = 0; p.x = 0; p.z = 0; }
}

// ---------------------------------------------------------------------------
// Simulation tick
// ---------------------------------------------------------------------------
function tick(dt) {
  if (players.size === 0) return;

  // nothing happens until at least one player has actually entered the arena
  if (!anyPlayersInGame()) return;

  if (wave === 0) startWave(1);

  // if everyone who entered is down, wipe and restart after a beat
  if (!anyPlayersActive()) {
    resetTimer += dt;
    if (resetTimer > 4) { fullReset(); broadcast({ t: "announce", text: "GRID RESTORED" }); startWave(1); }
    return;
  }
  resetTimer = 0;

  // spawn / wave progression
  if (spawnQueue > 0) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnEnemy();
      spawnQueue--;
      spawnTimer = Math.max(0.32, 1.4 - wave * 0.08);
    }
  } else {
    let live = 0;
    for (const e of enemies.values()) if (!e.dead) live++;
    if (live === 0) {
      betweenWaves += dt;
      if (!clearAnnounced) { clearAnnounced = true; broadcast({ t: "announce", text: "SECTOR CLEAR" }); }
      if (betweenWaves > 3) {
        for (const p of players.values()) p.hp = Math.min(100, p.hp + 25); // resupply heal
        startWave(wave + 1);
      }
    }
  }

  // enemy AI
  for (const [id, e] of enemies) {
    if (e.dead) {
      e.dying -= dt;
      if (e.dying <= 0) enemies.delete(id);
      continue;
    }

    // nearest alive player
    let target = null, best = Infinity;
    for (const p of players.values()) {
      if (!p.alive || !p.inGame) continue;
      const d = (p.x - e.x) ** 2 + (p.z - e.z) ** 2;
      if (d < best) { best = d; target = p; }
    }
    if (!target) continue;

    const dist = Math.sqrt(best) || 0.0001;
    const dx = (target.x - e.x) / dist;
    const dz = (target.z - e.z) / dist;
    e.yaw = Math.atan2(dx, dz);

    const st = kindStats(e.kind);
    const range = 1.7 * st.scale + 0.7;

    if (dist > range) {
      e.x += dx * e.speed * dt;
      e.z += dz * e.speed * dt;
      e.state = "walk";
    } else {
      e.state = "attack";
      e.attackCd -= dt;
      if (e.attackCd <= 0) {
        e.attackCd = 0.9;
        target.hp -= st.dmg;
        if (target.ws.readyState === 1) target.ws.send(JSON.stringify({ t: "hurt", dmg: st.dmg }));
        if (target.hp <= 0 && target.alive) {
          target.hp = 0;
          target.alive = false;
          target.inGame = false;
          broadcast({ t: "playerDown", id: target.id, name: target.name });
        }
      }
    }

    // separation from other enemies
    for (const o of enemies.values()) {
      if (o === e || o.dead) continue;
      const ox = e.x - o.x, oz = e.z - o.z;
      const d2 = ox * ox + oz * oz;
      if (d2 < 1.4 && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const push = (1.4 - d) * 2 * dt;
        e.x += (ox / d) * push;
        e.z += (oz / d) * push;
      }
    }

    e.x = Math.max(-ARENA + 1, Math.min(ARENA - 1, e.x));
    e.z = Math.max(-ARENA + 1, Math.min(ARENA - 1, e.z));
  }
}

// ---------------------------------------------------------------------------
// Snapshot broadcast
// ---------------------------------------------------------------------------
function sendSnapshot() {
  if (players.size === 0) return;
  const ps = [];
  for (const p of players.values()) {
    ps.push({
      id: p.id, n: p.name,
      x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
      ry: +p.ry.toFixed(3), rx: +p.rx.toFixed(3),
      hp: Math.round(p.hp), a: p.alive ? 1 : 0, sc: p.score, k: p.kills, mv: p.moving ? 1 : 0,
    });
  }
  const es = [];
  for (const e of enemies.values()) {
    es.push({
      id: e.id, x: +e.x.toFixed(2), z: +e.z.toFixed(2), y: +e.yaw.toFixed(2),
      k: e.kind, s: e.dead ? "dead" : e.state, hp: +e.hp.toFixed(1), mx: e.maxHp,
    });
  }
  broadcast({ t: "snap", ps, es, wave, score, kills });
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server: httpServer });

// drop dead sockets (closed laptops, killed tabs) so ghosts don't linger
const heartbeat = setInterval(() => {
  for (const p of players.values()) {
    if (p.ws.isAlive === false) { try { p.ws.terminate(); } catch (_) {} continue; }
    p.ws.isAlive = false;
    try { p.ws.ping(); } catch (_) {}
  }
}, 8000);

wss.on("connection", (ws) => {
  const id = nextPlayerId++;
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  const p = {
    ws, id, name: "PLAYER " + id,
    x: 0, y: 1.7, z: 0, ry: 0, rx: 0,
    hp: 100, score: 0, kills: 0, alive: true, moving: false,
    inGame: false, // true only once the player has pressed ENGAGE / redeployed
  };
  players.set(id, p);

  ws.send(JSON.stringify({ t: "init", id, arena: ARENA }));
  broadcast({ t: "sys", text: `PLAYER ${id} joined  ·  ${players.size} online` });

  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch (_) { return; }

    switch (m.t) {
      case "join":
        p.name = String(m.name || p.name).replace(/[^\x20-\x7E]/g, "").trim().slice(0, 16) || ("PLAYER " + id);
        broadcast({ t: "sys", text: `${p.name} is on the grid` });
        break;

      case "state":
        p.x = +m.x || 0; p.y = +m.y || 1.7; p.z = +m.z || 0;
        p.ry = +m.ry || 0; p.rx = +m.rx || 0;
        p.moving = !!m.mv;
        p.inGame = true;
        break;

      case "shoot":
        broadcast({ t: "shot", id, ox: m.ox, oy: m.oy, oz: m.oz, ex: m.ex, ey: m.ey, ez: m.ez });
        break;

      case "hit": {
        const e = enemies.get(m.id);
        if (!e || e.dead) break;
        e.hp -= +m.dmg || 0;
        if (e.hp <= 0) {
          e.dead = true;
          e.dying = 0.6;
          const st = kindStats(e.kind);
          score += st.pts; kills += 1;
          p.score += st.pts; p.kills += 1;
          broadcast({ t: "kill", id: e.id, by: id, byName: p.name, kind: e.kind, x: +e.x.toFixed(2), z: +e.z.toFixed(2) });
        } else {
          broadcast({ t: "ehit", id: e.id, head: !!m.head, x: +e.x.toFixed(2), z: +e.z.toFixed(2) });
        }
        break;
      }

      case "respawn": {
        const ang = (p.id * 1.7) % (Math.PI * 2);
        p.hp = 100; p.alive = true; p.inGame = true;
        p.x = Math.cos(ang) * 4; p.z = Math.sin(ang) * 4;
        broadcast({ t: "sys", text: `${p.name} redeployed` });
        break;
      }
    }
  });

  ws.on("close", () => {
    players.delete(id);
    broadcast({ t: "left", id });
    broadcast({ t: "sys", text: `PLAYER ${id} left  ·  ${players.size} online` });
    if (players.size === 0) fullReset();
  });
});

// ---------------------------------------------------------------------------
// Loops
// ---------------------------------------------------------------------------
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  tick(dt);
}, 1000 / TICK_HZ);

setInterval(sendSnapshot, 1000 / SNAP_HZ);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
httpServer.listen(PORT, () => {
  const nets = os.networkInterfaces();
  const lan = [];
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === "IPv4" && !ni.internal) lan.push(ni.address);
    }
  }
  console.log("\n  NEON BREACH — co-op server\n");
  console.log("  Local:   http://localhost:" + PORT);
  for (const ip of lan) console.log("  Network: http://" + ip + ":" + PORT + "   <- share this with players on your Wi-Fi");
  console.log("\n  Ctrl+C to stop.\n");
});
