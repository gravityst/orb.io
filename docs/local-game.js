// =====================================================
// LocalGame — offline agar.io engine with AI bots
// =====================================================

class LocalGame {
  constructor(playerName, skinIdx) {
    this.MAP_SIZE = 10000;
    this.FOOD_COUNT = 1500;
    this.VIRUS_COUNT = 30;
    this.START_MASS = 20;
    this.EAT_RATIO = 1.08;
    this.BOT_COUNT = 15;
    this.nextId = 1;
    this.players = [];
    this.food = [];
    this.viruses = [];
    this.ejected = [];
    this.playerId = null;
    this.deathCallback = null;

    // Spawn player
    const p = this._createPlayer(playerName, false, skinIdx);
    this.playerId = p.id;

    // Spawn bots
    const BOT_NAMES = ['Nova','Pulsar','Quasar','Comet','Meteor','Nebula','Helix','Orion','Vega','Lyra','Sol','Luna','Atlas','Titan','Rhea','Io'];
    for (let i = 0; i < this.BOT_COUNT; i++) {
      this._createPlayer(BOT_NAMES[i % BOT_NAMES.length], true, Math.floor(Math.random() * 20));
    }

    // Spawn food + viruses
    for (let i = 0; i < this.FOOD_COUNT; i++) this.food.push(this._createFood());
    for (let i = 0; i < this.VIRUS_COUNT; i++) this.viruses.push(this._createVirus());
  }

  onPlayerDeath(cb) { this.deathCallback = cb; }
  setPlayerTarget(x, y) {
    const me = this.players.find(p => p.id === this.playerId);
    if (me) { me.targetX = x; me.targetY = y; }
  }

  _rpos(power = 1.0) {
    const r = Math.pow(Math.random(), power) * (this.MAP_SIZE / 2 - 100);
    const a = Math.random() * Math.PI * 2;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }
  _massToRadius(m) { return Math.sqrt(m) * 3.5; }
  _massToSpeed(m) { return Math.max(60, 300 - Math.sqrt(m) * 2.5); }

  _createPlayer(name, isBot, skinIdx) {
    const id = this.nextId++;
    const pos = this._rpos(isBot ? 0.8 : 1.5);
    const cell = { id: this.nextId++, x: pos.x, y: pos.y, vx: 0, vy: 0, mass: this.START_MASS, mergeTime: 0 };
    const p = { id, name, skin: skinIdx || 0, cells: [cell], targetX: pos.x, targetY: pos.y, alive: true, isBot, kills: 0, botTimer: 0 };
    this.players.push(p);
    return p;
  }

  _createFood() {
    const r = Math.random();
    let mass = r < 0.80 ? 1 : r < 0.95 ? 3 : r < 0.99 ? 8 : 20;
    const pos = this._rpos(1.0);
    return { x: pos.x, y: pos.y, mass, color: Math.floor(Math.random() * 12) };
  }

  _createVirus() {
    const pos = this._rpos(0.9);
    return { id: this.nextId++, x: pos.x, y: pos.y, mass: 100 };
  }

  playerSplit() {
    const me = this.players.find(p => p.id === this.playerId);
    if (!me) return;
    const now = Date.now();
    const newCells = [];
    for (const cell of me.cells) {
      if (cell.mass < 35 || me.cells.length + newCells.length >= 16) { newCells.push(cell); continue; }
      const half = cell.mass / 2;
      cell.mass = half; cell.mergeTime = now + 15000;
      const dx = me.targetX - cell.x, dy = me.targetY - cell.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      newCells.push(cell);
      newCells.push({ id: this.nextId++, x: cell.x, y: cell.y, vx: (dx/d)*1200, vy: (dy/d)*1200, mass: half, mergeTime: now + 15000 });
    }
    me.cells = newCells;
  }

  playerEject() {
    const me = this.players.find(p => p.id === this.playerId);
    if (!me) return;
    for (const cell of me.cells) {
      if (cell.mass < 30) continue;
      cell.mass -= 12;
      const dx = me.targetX - cell.x, dy = me.targetY - cell.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const r = this._massToRadius(cell.mass);
      this.ejected.push({ x: cell.x + (dx/d)*r, y: cell.y + (dy/d)*r, vx: (dx/d)*700, vy: (dy/d)*700, mass: 12, color: me.skin, life: 5 });
    }
  }

  tick(dt) {
    // Bots
    for (const p of this.players) { if (p.isBot && p.alive) this._botAI(p, dt); }
    // Update players
    for (const p of this.players) { if (p.alive) this._updatePlayer(p, dt); }
    // Ejected
    for (let i = this.ejected.length - 1; i >= 0; i--) {
      const e = this.ejected[i]; e.x += e.vx * dt; e.y += e.vy * dt; e.vx *= 0.95; e.vy *= 0.95; e.life -= dt;
      if (e.life <= 0) this.ejected.splice(i, 1);
    }
    // Collisions
    this._checkCollisions();
    // Respawn bots
    for (const p of this.players) { if (p.isBot && !p.alive) this._respawnBot(p); }
    // Replenish
    while (this.food.length < this.FOOD_COUNT) this.food.push(this._createFood());
    while (this.viruses.length < this.VIRUS_COUNT) this.viruses.push(this._createVirus());
  }

  _updatePlayer(p, dt) {
    const now = Date.now();
    for (const cell of p.cells) {
      cell.x += cell.vx * dt; cell.y += cell.vy * dt;
      cell.vx *= 0.88; cell.vy *= 0.88;
      const speed = this._massToSpeed(cell.mass);
      const dx = p.targetX - cell.x, dy = p.targetY - cell.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1) { const mv = Math.min(d, speed * dt); cell.x += (dx/d)*mv; cell.y += (dy/d)*mv; }
      if (cell.mass > this.START_MASS) cell.mass *= (1 - 0.001 * dt);
      const r = this._massToRadius(cell.mass), half = this.MAP_SIZE / 2;
      cell.x = Math.max(-half + r, Math.min(half - r, cell.x));
      cell.y = Math.max(-half + r, Math.min(half - r, cell.y));
    }
    // Eat food
    for (const cell of p.cells) {
      const r = this._massToRadius(cell.mass);
      for (let i = this.food.length - 1; i >= 0; i--) {
        const f = this.food[i]; const dx = f.x - cell.x, dy = f.y - cell.y;
        if (dx * dx + dy * dy < r * r) { cell.mass += f.mass; this.food.splice(i, 1); }
      }
      for (let i = this.ejected.length - 1; i >= 0; i--) {
        const e = this.ejected[i]; const dx = e.x - cell.x, dy = e.y - cell.y;
        if (dx * dx + dy * dy < r * r && cell.mass > 30) { cell.mass += e.mass; this.ejected.splice(i, 1); }
      }
    }
    // Virus collision
    for (const cell of p.cells) {
      const r = this._massToRadius(cell.mass);
      for (let i = this.viruses.length - 1; i >= 0; i--) {
        const v = this.viruses[i]; if (cell.mass < v.mass * 1.3) continue;
        const dx = v.x - cell.x, dy = v.y - cell.y, vr = this._massToRadius(v.mass);
        if (dx*dx+dy*dy < ((r+vr)*0.5)**2) { this.viruses.splice(i, 1); this._popCell(p, cell); break; }
      }
    }
    // Merge
    for (let i = 0; i < p.cells.length; i++) {
      for (let j = i + 1; j < p.cells.length; j++) {
        const a = p.cells[i], b = p.cells[j];
        if (now < a.mergeTime || now < b.mergeTime) { // push apart
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx*dx+dy*dy) || 0.01;
          const overlap = this._massToRadius(a.mass) + this._massToRadius(b.mass) - d;
          if (overlap > 0) { const push = overlap/2; a.x -= (dx/d)*push; a.y -= (dy/d)*push; b.x += (dx/d)*push; b.y += (dy/d)*push; }
          continue;
        }
        const ra = this._massToRadius(a.mass), dx = b.x - a.x, dy = b.y - a.y;
        if (Math.sqrt(dx*dx+dy*dy) < ra) { a.mass += b.mass; p.cells.splice(j, 1); j--; }
      }
    }
    if (p.cells.length === 0) {
      p.alive = false;
      if (p.id === this.playerId && this.deathCallback) {
        this.deathCallback(0);
      }
    }
  }

  _popCell(p, cell) {
    const now = Date.now();
    const frags = Math.min(8, 16 - p.cells.length + 1);
    if (frags <= 1) { cell.mass += 50; return; }
    const each = cell.mass / frags; cell.mass = each; cell.mergeTime = now + 15000;
    for (let i = 1; i < frags; i++) {
      const a = (i / frags) * Math.PI * 2;
      p.cells.push({ id: this.nextId++, x: cell.x, y: cell.y, vx: Math.cos(a)*600, vy: Math.sin(a)*600, mass: each, mergeTime: now + 15000 });
    }
  }

  _checkCollisions() {
    for (const a of this.players) {
      if (!a.alive) continue;
      for (const cellA of a.cells) {
        const rA = this._massToRadius(cellA.mass);
        for (const b of this.players) {
          if (a.id === b.id || !b.alive) continue;
          for (let j = b.cells.length - 1; j >= 0; j--) {
            const cellB = b.cells[j];
            if (cellA.mass < cellB.mass * this.EAT_RATIO) continue;
            const dx = cellB.x - cellA.x, dy = cellB.y - cellA.y;
            if (Math.sqrt(dx*dx+dy*dy) < rA) {
              cellA.mass += cellB.mass; b.cells.splice(j, 1); a.kills++;
              if (b.cells.length === 0) {
                b.alive = false;
                if (b.id === this.playerId && this.deathCallback) this.deathCallback(0);
              }
            }
          }
        }
      }
    }
  }

  _respawnBot(p) {
    const pos = this._rpos(0.8);
    p.cells = [{ id: this.nextId++, x: pos.x, y: pos.y, vx: 0, vy: 0, mass: this.START_MASS, mergeTime: 0 }];
    p.targetX = pos.x; p.targetY = pos.y; p.alive = true; p.kills = 0;
    p.skin = Math.floor(Math.random() * 20);
  }

  _botAI(p, dt) {
    p.botTimer -= dt; if (p.botTimer > 0) return;
    p.botTimer = 0.3 + Math.random() * 0.4;
    if (p.cells.length === 0) return;
    const main = p.cells.reduce((m, c) => c.mass > m.mass ? c : m, p.cells[0]);
    // Avoid threats
    for (const o of this.players) {
      if (o.id === p.id || !o.alive) continue;
      for (const c of o.cells) {
        if (c.mass < main.mass * this.EAT_RATIO) continue;
        const dx = c.x - main.x, dy = c.y - main.y, d = Math.sqrt(dx*dx+dy*dy);
        if (d < 500) { p.targetX = main.x - dx; p.targetY = main.y - dy; return; }
      }
    }
    // Chase prey
    for (const o of this.players) {
      if (o.id === p.id || !o.alive) continue;
      for (const c of o.cells) {
        if (main.mass < c.mass * this.EAT_RATIO) continue;
        const dx = c.x - main.x, dy = c.y - main.y, d = Math.sqrt(dx*dx+dy*dy);
        if (d < 600) { p.targetX = c.x; p.targetY = c.y; return; }
      }
    }
    // Seek food
    let cl = null, cd = 350;
    for (const f of this.food) {
      const dx = f.x - main.x, dy = f.y - main.y;
      if (Math.abs(dx) > 350 || Math.abs(dy) > 350) continue;
      const d = Math.sqrt(dx*dx+dy*dy);
      if (d < cd) { cd = d; cl = f; }
    }
    if (cl) { p.targetX = cl.x; p.targetY = cl.y; return; }
    p.targetX = main.x + (Math.random()-0.5)*500;
    p.targetY = main.y + (Math.random()-0.5)*500;
  }
}
