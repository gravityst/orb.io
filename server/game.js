const WebSocket = require('ws');

// =====================================================
// Orb.io — agar.io-style game server
// Blobs grow by eating food and smaller blobs
// =====================================================

const MAP_SIZE = 10000;
const FOOD_COUNT = 1500;
const MAX_FOOD = 2000;
const VIRUS_COUNT = 30;
const MAX_PLAYERS_PER_ROOM = 30;
const MAX_BOTS = 12;
const TICK_RATE = 30;
const TICK_MS = 1000 / TICK_RATE;
const BROADCAST_RATE = 30;
const BROADCAST_MS = 1000 / BROADCAST_RATE;

const START_MASS = 20;
const MIN_SPLIT_MASS = 35;
const MAX_CELLS = 16;
const EJECT_MASS = 12;
const MIN_EJECT_MASS = 30;
const MERGE_COOLDOWN = 15000; // ms before split cells can merge back
const MASS_DECAY_RATE = 0.001; // per second (0.1% loss)
const EAT_SIZE_RATIO = 1.08; // must be 8% bigger to eat
const SKINS_COUNT = 20;

const ROOM_NAMES = ['Nebula', 'Cosmos', 'Stardust'];

const BOT_NAMES = [
  'Nova','Pulsar','Quasar','Comet','Meteor','Nebula','Helix','Orion',
  'Vega','Lyra','Sol','Luna','Atlas','Titan','Rhea','Io',
];

function massToRadius(m) { return Math.sqrt(m) * 3.5; }
function massToSpeed(m) { return Math.max(60, 300 - Math.sqrt(m) * 2.5); } // bigger = slower, min 60

class Room {
  constructor(id, name, opts = {}) {
    this.id = id;
    this.name = name;
    this.isCustom = opts.isCustom || false;
    this.code = opts.isCustom ? this._genCode() : null;

    this.players = new Map();   // playerId → player { id, name, skin, cells[], ... }
    this.food = [];
    this.viruses = [];
    this.ejected = []; // ejected mass particles
    this.bots = [];
    this.nextId = 1;
    this.clients = new Map();   // ws → playerId

    this.tickInterval = null;
    this.broadcastInterval = null;
    this.running = false;
    this.lastTick = Date.now();
  }

  _genCode() {
    const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
    let s = ''; for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
    return s;
  }

  _startLoop() {
    if (this.running) return;
    this.running = true;
    this.lastTick = Date.now();
    this.tickInterval = setInterval(() => this.tick(), TICK_MS);
    this.broadcastInterval = setInterval(() => {
      this.broadcastState();
      this.broadcastLeaderboard();
    }, BROADCAST_MS);
  }

  _stopLoop() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.tickInterval);
    clearInterval(this.broadcastInterval);
    this.tickInterval = null;
    this.broadcastInterval = null;
  }

  _init() {
    if (this.food.length > 0) return;
    this._spawnFood();
    this._spawnViruses();
    this._spawnBots(MAX_BOTS);
  }

  _randomPos(power = 1.0) {
    const r = Math.pow(Math.random(), power) * (MAP_SIZE / 2 - 100);
    const a = Math.random() * Math.PI * 2;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }

  get realPlayerCount() { return this.clients.size; }
  get targetBotCount() { return Math.max(0, MAX_BOTS - this.realPlayerCount); }

  // --- Food ---
  _spawnFood() { while (this.food.length < FOOD_COUNT) this.food.push(this._createFood()); }
  _createFood() {
    const r = Math.random();
    let mass;
    if (r < 0.80) mass = 1;        // tiny pellets
    else if (r < 0.95) mass = 3;   // small
    else if (r < 0.99) mass = 8;   // medium rare
    else mass = 20;                // rare big "bloat" orb
    const pos = this._randomPos(1.0);
    return { x: pos.x, y: pos.y, mass, color: Math.floor(Math.random() * 12) };
  }

  // --- Viruses ---
  _spawnViruses() { while (this.viruses.length < VIRUS_COUNT) this.viruses.push(this._createVirus()); }
  _createVirus() {
    const pos = this._randomPos(0.9);
    return { id: this.nextId++, x: pos.x, y: pos.y, mass: 100 };
  }

  // --- Bots / Players ---
  _spawnBots(count) {
    for (let i = 0; i < count; i++) {
      const p = this._createPlayer(BOT_NAMES[i % BOT_NAMES.length], true, Math.floor(Math.random() * SKINS_COUNT));
      this.bots.push(p.id);
    }
  }

  _createPlayer(name, isBot, skinIdx) {
    const id = this.nextId++;
    const pos = isBot ? this._randomPos(0.8) : this._randomPos(1.5);
    const cell = {
      id: this.nextId++,
      x: pos.x, y: pos.y,
      vx: 0, vy: 0,
      mass: START_MASS,
      birthTime: Date.now(),
      mergeTime: Date.now(), // can always merge at start
    };
    const player = {
      id,
      name: name.substring(0, 16),
      skin: skinIdx || 0,
      cells: [cell],
      targetX: pos.x, targetY: pos.y,
      alive: true,
      isBot,
      kills: 0,
      botTimer: 0,
    };
    this.players.set(id, player);
    return player;
  }

  playerJoin(ws, name, skinIdx) {
    if (this.clients.has(ws)) return;
    if (this.realPlayerCount >= MAX_PLAYERS_PER_ROOM) return;
    this._init();
    const player = this._createPlayer(name, false, skinIdx);
    this.clients.set(ws, player.id);
    this._startLoop();
    // Welcome: [0x02][version u8][playerId u16]
    const buf = Buffer.alloc(4);
    buf[0] = 0x02; buf[1] = 1; buf.writeUInt16LE(player.id, 2);
    ws.send(buf);
    this._adjustBots();
    console.log(`[${this.name}] ${name} joined (${this.realPlayerCount} players)`);
  }

  playerLeave(ws) {
    const pid = this.clients.get(ws);
    if (pid === undefined) return;
    this.players.delete(pid);
    this.clients.delete(ws);
    this._adjustBots();
    if (this.realPlayerCount === 0) this._stopLoop();
  }

  _adjustBots() {
    const target = this.targetBotCount;
    while (this.bots.length > target) {
      const botId = this.bots.pop();
      this.players.delete(botId);
    }
    while (this.bots.length < target) {
      const p = this._createPlayer(BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)], true, Math.floor(Math.random() * SKINS_COUNT));
      this.bots.push(p.id);
    }
  }

  handleMessage(ws, data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (buf.length < 1) return;
    const type = buf[0];

    if (type === 0x03) {
      // Join: [0x03][skin u8][name...]
      const skin = buf.length > 1 ? buf[1] : 0;
      const name = buf.slice(2).toString('utf8').substring(0, 16) || 'Player';
      this.playerJoin(ws, name, skin);
      return;
    }

    const pid = this.clients.get(ws);
    if (pid === undefined) return;
    const player = this.players.get(pid);
    if (!player || !player.alive) return;

    if (type === 0x01 && buf.length >= 9) {
      // Mouse target (world coords): [0x01][float32 x][float32 y]
      player.targetX = buf.readFloatLE(1);
      player.targetY = buf.readFloatLE(5);
    } else if (type === 0x04) {
      // Split
      this._playerSplit(player);
    } else if (type === 0x05) {
      // Eject mass
      this._playerEject(player);
    }
  }

  _playerSplit(player) {
    if (player.cells.length >= MAX_CELLS) return;
    const now = Date.now();
    const newCells = [];
    for (const cell of player.cells) {
      if (cell.mass < MIN_SPLIT_MASS) { newCells.push(cell); continue; }
      if (player.cells.length + newCells.length >= MAX_CELLS) { newCells.push(cell); continue; }
      const half = cell.mass / 2;
      cell.mass = half;
      cell.mergeTime = now + MERGE_COOLDOWN;
      // Direction toward target
      const dx = player.targetX - cell.x, dy = player.targetY - cell.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const boost = 1200; // fast split launch to catch prey
      const newCell = {
        id: this.nextId++,
        x: cell.x, y: cell.y,
        vx: (dx / d) * boost,
        vy: (dy / d) * boost,
        mass: half,
        birthTime: now,
        mergeTime: now + MERGE_COOLDOWN,
      };
      newCells.push(cell);
      newCells.push(newCell);
    }
    player.cells = newCells;
  }

  _playerEject(player) {
    for (const cell of player.cells) {
      if (cell.mass < MIN_EJECT_MASS) continue;
      cell.mass -= EJECT_MASS;
      const dx = player.targetX - cell.x, dy = player.targetY - cell.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = dx / d, ny = dy / d;
      const r = massToRadius(cell.mass);
      this.ejected.push({
        x: cell.x + nx * r, y: cell.y + ny * r,
        vx: nx * 700, vy: ny * 700,
        mass: EJECT_MASS,
        color: player.skin,
        life: 5,
      });
    }
  }

  tick() {
    const now = Date.now();
    const dt = Math.min((now - this.lastTick) / 1000, 0.05);
    this.lastTick = now;

    // Bot AI
    for (const [, p] of this.players) {
      if (p.isBot && p.alive) this._botAI(p, dt);
    }

    // Update players (cells)
    for (const [, p] of this.players) {
      if (!p.alive) continue;
      this._updatePlayer(p, dt);
    }

    // Update ejected mass
    for (let i = this.ejected.length - 1; i >= 0; i--) {
      const e = this.ejected[i];
      e.x += e.vx * dt; e.y += e.vy * dt;
      e.vx *= 0.95; e.vy *= 0.95;
      e.life -= dt;
      if (Math.abs(e.vx) < 5 && Math.abs(e.vy) < 5) { e.vx = 0; e.vy = 0; }
      if (e.life <= 0) this.ejected.splice(i, 1);
    }

    // Collisions
    this._checkCollisions();

    // Respawn dead bots
    for (const pid of this.bots) {
      const p = this.players.get(pid);
      if (p && !p.alive) this._respawnBot(p);
    }

    this._spawnFood();
    this._spawnViruses();
    while (this.food.length > MAX_FOOD) this.food.shift();
  }

  _updatePlayer(p, dt) {
    const now = Date.now();
    const mergeable = [];
    // Update each cell
    for (const cell of p.cells) {
      // Apply velocity (from split/eject recoil)
      cell.x += cell.vx * dt; cell.y += cell.vy * dt;
      // Friction — higher for normal movement, lower for split velocity
      const friction = (Math.abs(cell.vx) > 200 || Math.abs(cell.vy) > 200) ? 0.92 : 0.96;
      cell.vx *= Math.pow(friction, dt * 60); cell.vy *= Math.pow(friction, dt * 60);

      // Move toward target with soft inertia (floaty agar.io feel)
      const speed = massToSpeed(cell.mass);
      const dx = p.targetX - cell.x, dy = p.targetY - cell.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1) {
        const nx = dx / d, ny = dy / d;
        // Acceleration toward cursor, not instant snap
        // Heavier cells accelerate slower (more inertia)
        const accel = speed * 3.0 / Math.max(1, Math.sqrt(cell.mass) * 0.3);
        cell.vx += nx * accel * dt;
        cell.vy += ny * accel * dt;
        // Cap velocity to max speed
        const vel = Math.sqrt(cell.vx * cell.vx + cell.vy * cell.vy);
        if (vel > speed) { cell.vx *= speed / vel; cell.vy *= speed / vel; }
      }

      // Mass decay
      if (cell.mass > START_MASS) {
        cell.mass *= (1 - MASS_DECAY_RATE * dt);
      }

      // Map bounds
      const r = massToRadius(cell.mass);
      const half = MAP_SIZE / 2;
      if (cell.x < -half + r) cell.x = -half + r;
      if (cell.x > half - r) cell.x = half - r;
      if (cell.y < -half + r) cell.y = -half + r;
      if (cell.y > half - r) cell.y = half - r;

      if (now >= cell.mergeTime) mergeable.push(cell);
    }

    // Eat food
    for (const cell of p.cells) {
      const r = massToRadius(cell.mass);
      for (let i = this.food.length - 1; i >= 0; i--) {
        const f = this.food[i];
        const dx = f.x - cell.x, dy = f.y - cell.y;
        if (dx * dx + dy * dy < r * r) {
          cell.mass += f.mass;
          this.food.splice(i, 1);
        }
      }
      // Eat ejected mass
      for (let i = this.ejected.length - 1; i >= 0; i--) {
        const e = this.ejected[i];
        const dx = e.x - cell.x, dy = e.y - cell.y;
        if (dx * dx + dy * dy < r * r && cell.mass > 30) {
          cell.mass += e.mass;
          this.ejected.splice(i, 1);
        }
      }
    }

    // Virus collisions — split big cells
    for (const cell of p.cells) {
      const r = massToRadius(cell.mass);
      for (let i = this.viruses.length - 1; i >= 0; i--) {
        const v = this.viruses[i];
        const vr = massToRadius(v.mass);
        if (cell.mass < v.mass * 1.3) continue; // too small to touch
        const dx = v.x - cell.x, dy = v.y - cell.y;
        if (dx * dx + dy * dy < (r + vr) * 0.5 * (r + vr) * 0.5) {
          // Hit the virus! Split into multiple cells
          this.viruses.splice(i, 1);
          this._popCellOnVirus(p, cell);
          break;
        }
      }
    }

    // Merge cells that are close and past cooldown
    for (let i = 0; i < p.cells.length; i++) {
      for (let j = i + 1; j < p.cells.length; j++) {
        const a = p.cells[i], b = p.cells[j];
        if (now < a.mergeTime || now < b.mergeTime) continue;
        const ra = massToRadius(a.mass), rb = massToRadius(b.mass);
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < Math.max(ra, rb)) {
          // Merge b into a
          a.mass += b.mass;
          p.cells.splice(j, 1);
          j--;
        }
      }
    }

    // Separate overlapping same-player cells (no merge cooldown)
    for (let i = 0; i < p.cells.length; i++) {
      for (let j = i + 1; j < p.cells.length; j++) {
        const a = p.cells[i], b = p.cells[j];
        if (now >= a.mergeTime && now >= b.mergeTime) continue;
        const ra = massToRadius(a.mass), rb = massToRadius(b.mass);
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const overlap = (ra + rb) - d;
        if (overlap > 0) {
          const push = overlap / 2;
          const nx = dx / d, ny = dy / d;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
        }
      }
    }

    if (p.cells.length === 0) {
      p.alive = false;
    }
  }

  _popCellOnVirus(p, cell) {
    const now = Date.now();
    const totalMass = cell.mass;
    const fragments = Math.min(8, MAX_CELLS - p.cells.length + 1);
    if (fragments <= 1) { cell.mass += 50; return; } // can't split, just gain mass
    const eachMass = totalMass / fragments;
    cell.mass = eachMass;
    cell.mergeTime = now + MERGE_COOLDOWN;
    for (let i = 1; i < fragments; i++) {
      const angle = (i / fragments) * Math.PI * 2;
      const speed = 600;
      p.cells.push({
        id: this.nextId++,
        x: cell.x, y: cell.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        mass: eachMass,
        birthTime: now,
        mergeTime: now + MERGE_COOLDOWN,
      });
    }
  }

  _checkCollisions() {
    const allPlayers = Array.from(this.players.values()).filter(p => p.alive);
    for (const a of allPlayers) {
      for (const cellA of a.cells) {
        const rA = massToRadius(cellA.mass);
        for (const b of allPlayers) {
          if (a.id === b.id) continue;
          for (let j = b.cells.length - 1; j >= 0; j--) {
            const cellB = b.cells[j];
            const rB = massToRadius(cellB.mass);
            const dx = cellB.x - cellA.x, dy = cellB.y - cellA.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            // Eating rule: bigger must engulf smaller's center + be 15% bigger
            if (cellA.mass >= cellB.mass * EAT_SIZE_RATIO && d < rA) {
              cellA.mass += cellB.mass;
              b.cells.splice(j, 1);
              if (b.cells.length === 0) {
                b.alive = false;
                a.kills++;
                // Broadcast kill event
                const buf = Buffer.alloc(5);
                buf[0] = 0x04;
                buf.writeUInt16LE(a.id, 1); buf.writeUInt16LE(b.id, 3);
                this.broadcast(buf);
                // Notify the player they died
                for (const [ws, pid] of this.clients) {
                  if (pid === b.id) {
                    const d = Buffer.alloc(3);
                    d[0] = 0x03; d.writeUInt16LE(b.id, 1);
                    if (ws.readyState === WebSocket.OPEN) ws.send(d);
                    this.clients.delete(ws);
                    break;
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  _respawnBot(p) {
    const pos = this._randomPos(0.8);
    p.cells = [{
      id: this.nextId++,
      x: pos.x, y: pos.y,
      vx: 0, vy: 0,
      mass: START_MASS,
      birthTime: Date.now(),
      mergeTime: Date.now(),
    }];
    p.targetX = pos.x; p.targetY = pos.y;
    p.alive = true;
    p.kills = 0;
    p.skin = Math.floor(Math.random() * SKINS_COUNT);
  }

  _botAI(p, dt) {
    p.botTimer -= dt;
    if (p.botTimer > 0) return;
    p.botTimer = 0.3 + Math.random() * 0.4;
    if (p.cells.length === 0) return;
    // Use largest cell as reference
    const main = p.cells.reduce((m, c) => c.mass > m.mass ? c : m, p.cells[0]);
    const mainR = massToRadius(main.mass);
    // Find threats (bigger cells nearby)
    let threat = null, threatD = 600;
    for (const other of this.players.values()) {
      if (other.id === p.id || !other.alive) continue;
      for (const c of other.cells) {
        if (c.mass < main.mass * EAT_SIZE_RATIO) continue;
        const dx = c.x - main.x, dy = c.y - main.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d < threatD) { threatD = d; threat = { x: c.x, y: c.y }; }
      }
    }
    if (threat) {
      // Flee
      p.targetX = main.x - (threat.x - main.x);
      p.targetY = main.y - (threat.y - main.y);
      return;
    }
    // Find prey (smaller cells nearby)
    let prey = null, preyD = 700;
    for (const other of this.players.values()) {
      if (other.id === p.id || !other.alive) continue;
      for (const c of other.cells) {
        if (main.mass < c.mass * EAT_SIZE_RATIO) continue;
        const dx = c.x - main.x, dy = c.y - main.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d < preyD) { preyD = d; prey = { x: c.x, y: c.y }; }
      }
    }
    if (prey) { p.targetX = prey.x; p.targetY = prey.y; return; }
    // Find food
    let closestFood = null, closestD = 400;
    for (const f of this.food) {
      const dx = f.x - main.x, dy = f.y - main.y;
      if (dx > 400 || dx < -400 || dy > 400 || dy < -400) continue;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < closestD) { closestD = d; closestFood = f; }
    }
    if (closestFood) { p.targetX = closestFood.x; p.targetY = closestFood.y; return; }
    // Wander
    p.targetX = main.x + (Math.random() - 0.5) * 600;
    p.targetY = main.y + (Math.random() - 0.5) * 600;
  }

  // --- Broadcasting ---
  broadcastState() {
    for (const [ws, pid] of this.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const me = this.players.get(pid);
      if (!me || !me.alive || me.cells.length === 0) continue;

      // Camera center = avg of cells
      let cx = 0, cy = 0, totalMass = 0;
      for (const c of me.cells) { cx += c.x * c.mass; cy += c.y * c.mass; totalMass += c.mass; }
      cx /= totalMass; cy /= totalMass;
      // View scales with total mass
      const viewRange = 1200 + Math.sqrt(totalMass) * 40;

      // Collect visible entities
      const visPlayers = [];
      for (const [, p] of this.players) {
        if (!p.alive) continue;
        let inView = false;
        for (const c of p.cells) {
          if (Math.abs(c.x - cx) < viewRange && Math.abs(c.y - cy) < viewRange) { inView = true; break; }
        }
        if (inView) visPlayers.push(p);
      }
      const visFood = this.food.filter(f => Math.abs(f.x - cx) < viewRange && Math.abs(f.y - cy) < viewRange);
      const visVir = this.viruses.filter(v => Math.abs(v.x - cx) < viewRange && Math.abs(v.y - cy) < viewRange);
      const visEj = this.ejected.filter(e => Math.abs(e.x - cx) < viewRange && Math.abs(e.y - cy) < viewRange);

      // Count total cells and name bytes
      let totalCells = 0, totalNameBytes = 0;
      for (const p of visPlayers) {
        totalCells += p.cells.length;
        totalNameBytes += Buffer.byteLength(p.name, 'utf8');
      }

      // Packet layout:
      // [0x01][playerCount u16]
      //   per player: [id u16][skin u8][isBot u8][kills u8][nameLen u8][name][cellCount u8]
      //     per cell: [x i16][y i16][mass u16]
      // [foodCount u16]
      //   per food: [x i16][y i16][color u8][mass u8]
      // [virCount u16]
      //   per vir: [x i16][y i16][mass u16]
      // [ejCount u16]
      //   per ej: [x i16][y i16][color u8]

      const bufSize = 1 + 2
        + visPlayers.length * (2 + 1 + 1 + 1 + 1 + 1) + totalNameBytes + totalCells * 6
        + 2 + visFood.length * 6
        + 2 + visVir.length * 6
        + 2 + visEj.length * 5;

      const buf = Buffer.alloc(bufSize);
      let off = 0;
      buf[off++] = 0x01;
      buf.writeUInt16LE(visPlayers.length, off); off += 2;
      for (const p of visPlayers) {
        buf.writeUInt16LE(p.id, off); off += 2;
        buf[off++] = p.skin;
        buf[off++] = p.isBot ? 1 : 0;
        buf[off++] = Math.min(p.kills || 0, 255);
        const nameBytes = Buffer.from(p.name, 'utf8');
        buf[off++] = nameBytes.length; nameBytes.copy(buf, off); off += nameBytes.length;
        buf[off++] = Math.min(p.cells.length, 255);
        for (const c of p.cells) {
          buf.writeInt16LE(Math.round(c.x), off); off += 2;
          buf.writeInt16LE(Math.round(c.y), off); off += 2;
          buf.writeUInt16LE(Math.min(Math.round(c.mass), 65535), off); off += 2;
        }
      }
      buf.writeUInt16LE(visFood.length, off); off += 2;
      for (const f of visFood) {
        buf.writeInt16LE(Math.round(f.x), off); off += 2;
        buf.writeInt16LE(Math.round(f.y), off); off += 2;
        buf[off++] = f.color;
        buf[off++] = Math.min(f.mass, 255);
      }
      buf.writeUInt16LE(visVir.length, off); off += 2;
      for (const v of visVir) {
        buf.writeInt16LE(Math.round(v.x), off); off += 2;
        buf.writeInt16LE(Math.round(v.y), off); off += 2;
        buf.writeUInt16LE(Math.min(Math.round(v.mass), 65535), off); off += 2;
      }
      buf.writeUInt16LE(visEj.length, off); off += 2;
      for (const e of visEj) {
        buf.writeInt16LE(Math.round(e.x), off); off += 2;
        buf.writeInt16LE(Math.round(e.y), off); off += 2;
        buf[off++] = e.color;
      }
      ws.send(buf.slice(0, off));
    }
  }

  broadcastLeaderboard() {
    const entries = Array.from(this.players.values())
      .filter(p => p.alive)
      .map(p => ({ id: p.id, name: p.name, isBot: p.isBot, score: p.cells.reduce((s, c) => s + c.mass, 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    let size = 2;
    for (const e of entries) size += 6 + Buffer.byteLength(e.name, 'utf8');
    const buf = Buffer.alloc(size);
    let off = 0;
    buf[off++] = 0x05; buf[off++] = entries.length;
    for (const e of entries) {
      buf.writeUInt16LE(e.id, off); off += 2;
      buf.writeUInt16LE(Math.min(Math.round(e.score), 65535), off); off += 2;
      buf[off++] = e.isBot ? 1 : 0;
      const nb = Buffer.from(e.name, 'utf8');
      buf[off++] = nb.length; nb.copy(buf, off); off += nb.length;
    }
    this.broadcast(buf.slice(0, off));
  }

  broadcast(data) {
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }
}

class RoomManager {
  constructor(httpServer) {
    this.rooms = new Map();
    this.wsToRoom = new Map();
    ROOM_NAMES.forEach((name, i) => this.rooms.set(`room-${i}`, new Room(`room-${i}`, name)));

    this.wss = new WebSocket.Server({ server: httpServer });
    this.wss.on('connection', (ws, req) => {
      ws.binaryType = 'arraybuffer';
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      const url = new URL(req.url, 'http://localhost');
      const roomId = url.searchParams.get('room') || 'room-0';
      const room = this.rooms.get(roomId);
      if (!room) { ws.close(4001, 'Room not found'); return; }
      this.wsToRoom.set(ws, room);
      ws.on('message', (data) => room.handleMessage(ws, data));
      ws.on('close', () => { room.playerLeave(ws); this.wsToRoom.delete(ws); });
    });

    setInterval(() => {
      for (const [ws] of this.wsToRoom) {
        if (!ws.isAlive) { ws.terminate(); continue; }
        ws.isAlive = false; ws.ping();
      }
    }, 10000);
  }

  createCustomRoom(name) {
    const id = 'custom-' + Date.now();
    const room = new Room(id, name, { isCustom: true });
    this.rooms.set(id, room);
    return room;
  }

  getRoomList() {
    return Array.from(this.rooms.entries()).map(([id, r]) => ({
      id, name: r.name, players: r.realPlayerCount, maxPlayers: MAX_PLAYERS_PER_ROOM,
      isCustom: r.isCustom, code: r.code,
    }));
  }
}

module.exports = { RoomManager };
