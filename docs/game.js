// =====================================================
// Orb.io client — cosmic multiplayer agar.io-style game
// =====================================================

(() => {
  'use strict';

  // --- DOM ---
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const startScreen = document.getElementById('startScreen');
  const skinScreen = document.getElementById('skinScreen');
  const roomScreen = document.getElementById('roomScreen');
  const deathScreen = document.getElementById('deathScreen');
  const hud = document.getElementById('hud');
  const nameInput = document.getElementById('nameInput');
  const playBtn = document.getElementById('playBtn');
  const skinsBtn = document.getElementById('skinsBtn');
  const skinBackBtn = document.getElementById('skinBackBtn');
  const skinGrid = document.getElementById('skinGrid');
  const roomList = document.getElementById('roomList');
  const roomBackBtn = document.getElementById('roomBackBtn');
  const respawnBtn = document.getElementById('respawnBtn');
  const mainMenuBtn = document.getElementById('mainMenuBtn');
  const leaderboardEntries = document.getElementById('leaderboardEntries');
  const myScoreEl = document.getElementById('myScore');
  const finalScoreEl = document.getElementById('finalScore');
  const playerCountEl = document.getElementById('playerCount');
  const minimapCanvas = document.getElementById('minimap');
  const mCtx = minimapCanvas.getContext('2d');
  const menuBg = document.getElementById('menuBg');
  const mbCtx = menuBg.getContext('2d');
  const statusText = document.getElementById('statusText');
  const serverStatus = document.getElementById('serverStatus');

  // --- Config ---
  const MAP_SIZE = 10000;
  const DEFAULT_SERVER_URL = 'https://orb-io.onrender.com';
  let CUSTOM_SERVER_URL = localStorage.getItem('customServerUrl') || '';
  (() => {
    const urlParam = new URLSearchParams(location.search).get('server');
    if (urlParam) {
      let s = urlParam.trim();
      if (!s.startsWith('http')) s = 'https://orbio-' + s + '.loca.lt';
      CUSTOM_SERVER_URL = s;
      localStorage.setItem('customServerUrl', s);
    }
  })();
  let SERVER_URL = CUSTOM_SERVER_URL || DEFAULT_SERVER_URL || '';

  // --- Skins: planet-like gradient palettes ---
  const SKINS = [
    { name: 'Mars',    inner: '#ffb47a', outer: '#c2451d' },
    { name: 'Jupiter', inner: '#f4e4c1', outer: '#a87545' },
    { name: 'Neptune', inner: '#6fb6ff', outer: '#1a4d9e' },
    { name: 'Venus',   inner: '#fff4c8', outer: '#e89b4f' },
    { name: 'Saturn',  inner: '#ffd28a', outer: '#b87c30' },
    { name: 'Uranus',  inner: '#b6f0f0', outer: '#3d9ba0' },
    { name: 'Earth',   inner: '#8fd1ff', outer: '#1e6a4a' },
    { name: 'Moon',    inner: '#f0f0ec', outer: '#8a8680' },
    { name: 'Pulsar',  inner: '#ffffff', outer: '#b48cff' },
    { name: 'Quasar',  inner: '#d8aaff', outer: '#5020a8' },
    { name: 'Nebula',  inner: '#ffccff', outer: '#a01c7a' },
    { name: 'Comet',   inner: '#c8f0ff', outer: '#4090c0' },
    { name: 'Galaxy',  inner: '#ffaaee', outer: '#331155' },
    { name: 'Void',    inner: '#222244', outer: '#000000' },
    { name: 'Sun',     inner: '#fff8aa', outer: '#e04000' },
    { name: 'Ember',   inner: '#ffcc55', outer: '#c02200' },
    { name: 'Toxic',   inner: '#d4ff88', outer: '#3a8020' },
    { name: 'Plasma',  inner: '#ffaaff', outer: '#0080ff' },
    { name: 'Frost',   inner: '#eaffff', outer: '#4080c0' },
    { name: 'Shadow',  inner: '#606060', outer: '#101020' },
  ];
  let selectedSkin = parseInt(localStorage.getItem('selectedSkin') || '0', 10);

  // --- State ---
  let players = [];
  let food = [], viruses = [], ejected = [];
  let myId = null, ws = null, running = false;
  let gameMode = null; // 'local' | 'multiplayer'
  let localGame = null;
  let camera = { x: 0, y: 0, zoom: 1 };
  let mouseX = 0, mouseY = 0;
  let lastFrame = 0, animTime = 0;
  let connId = 0;
  let lastServerPing = 0;
  const displayRadius = new Map(); // cellKey → displayed radius (smoothed)

  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; menuBg.width = window.innerWidth; menuBg.height = window.innerHeight; }
  window.addEventListener('resize', resize); resize();

  // Input
  canvas.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });
  window.addEventListener('keydown', (e) => {
    if (!running) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (gameMode === 'local' && localGame) localGame.playerSplit();
      else sendSplit();
    } else if (e.code === 'KeyW') {
      e.preventDefault();
      if (gameMode === 'local' && localGame) localGame.playerEject();
      else sendEject();
    }
  });

  // Skin picker
  function buildSkinGrid() {
    skinGrid.innerHTML = '';
    SKINS.forEach((skin, idx) => {
      const card = document.createElement('div');
      card.className = 'skin-card' + (idx === selectedSkin ? ' selected' : '');
      const c = document.createElement('canvas');
      c.width = 70; c.height = 70;
      const cx = c.getContext('2d');
      drawOrb(cx, 35, 35, 28, skin);
      card.appendChild(c);
      card.addEventListener('click', () => {
        selectedSkin = idx;
        localStorage.setItem('selectedSkin', idx);
        document.querySelectorAll('.skin-card').forEach(x => x.classList.remove('selected'));
        card.classList.add('selected');
      });
      skinGrid.appendChild(card);
    });
  }
  buildSkinGrid();

  function drawOrb(cx, x, y, r, skin) {
    if (r < 1) return;
    const grad = cx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    grad.addColorStop(0, skin.inner);
    grad.addColorStop(1, skin.outer);
    cx.fillStyle = grad;
    cx.beginPath();
    cx.arc(x, y, r, 0, Math.PI * 2);
    cx.fill();
    // Thin outer ring
    cx.strokeStyle = 'rgba(255,255,255,0.15)';
    cx.lineWidth = Math.max(1, r * 0.04);
    cx.stroke();
  }

  const playAIBtn = document.getElementById('playAIBtn');
  playAIBtn.addEventListener('click', startLocalGame);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startLocalGame(); });

  function startLocalGame() {
    gameMode = 'local';
    const name = nameInput.value.trim() || 'Player';
    localGame = new LocalGame(name, selectedSkin);
    myId = localGame.playerId;
    localGame.onPlayerDeath((mass) => {
      const me = localGame.players.find(p => p.id === myId);
      const totalMass = me ? me.cells.reduce((s, c) => s + c.mass, 0) : mass;
      finalScoreEl.textContent = Math.round(totalMass);
      deathScreen.style.display = 'flex';
      running = false;
    });
    const me = localGame.players.find(p => p.id === myId);
    if (me && me.cells.length > 0) { camera.x = me.cells[0].x; camera.y = me.cells[0].y; }
    hideAllScreens(); hud.style.display = 'block'; running = true;
  }

  playBtn.addEventListener('click', () => {
    hideAllScreens(); roomScreen.style.display = 'flex';
    fetchRooms();
  });
  skinsBtn.addEventListener('click', () => { hideAllScreens(); skinScreen.style.display = 'flex'; });
  skinBackBtn.addEventListener('click', () => { hideAllScreens(); startScreen.style.display = 'flex'; });
  roomBackBtn.addEventListener('click', () => { hideAllScreens(); startScreen.style.display = 'flex'; });
  respawnBtn.addEventListener('click', () => {
    if (gameMode === 'local') startLocalGame();
    else if (currentRoomId) startGame(currentRoomId);
  });
  mainMenuBtn.addEventListener('click', () => {
    disconnect();
    gameMode = null; running = false; myId = null; localGame = null;
    players = []; food = []; viruses = []; ejected = [];
    hideAllScreens(); startScreen.style.display = 'flex';
  });

  function hideAllScreens() {
    startScreen.style.display = 'none';
    roomScreen.style.display = 'none';
    skinScreen.style.display = 'none';
    deathScreen.style.display = 'none';
    hud.style.display = 'none';
  }

  let currentRoomId = null;

  async function fetchRooms() {
    try {
      const res = await fetch(SERVER_URL + '/api/rooms');
      const rooms = await res.json();
      roomList.innerHTML = '';
      for (const room of rooms) {
        const card = document.createElement('div');
        card.className = 'room-card' + (room.players >= room.maxPlayers ? ' full' : '');
        card.innerHTML = `<span class="room-name">${room.name}</span><span class="room-players">${room.players}/${room.maxPlayers}</span>`;
        if (room.players < room.maxPlayers) {
          card.addEventListener('click', () => startGame(room.id));
        }
        roomList.appendChild(card);
      }
    } catch (e) {
      roomList.innerHTML = '<p style="color:#f66;">Server offline — try again later</p>';
    }
  }

  function startGame(roomId) {
    gameMode = 'multiplayer';
    currentRoomId = roomId;
    localGame = null;
    const name = nameInput.value.trim() || 'Player';
    connect(name, roomId);
    hideAllScreens(); hud.style.display = 'block';
    running = true;
  }

  function disconnect() {
    connId++;
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
  }

  function connect(name, roomId) {
    disconnect();
    const myConnId = ++connId;
    const wsUrl = SERVER_URL.replace('https://', 'wss://').replace('http://', 'ws://');
    ws = new WebSocket(`${wsUrl}?room=${encodeURIComponent(roomId)}`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      if (connId !== myConnId) return;
      const nameBytes = new TextEncoder().encode(name.substring(0, 16));
      const buf = new Uint8Array(2 + nameBytes.length);
      buf[0] = 0x03; buf[1] = selectedSkin; buf.set(nameBytes, 2);
      ws.send(buf);
    };
    ws.onmessage = (evt) => {
      if (connId !== myConnId) return;
      const buf = new DataView(evt.data);
      if (buf.byteLength < 1) return;
      const type = buf.getUint8(0);
      if (type === 0x02) myId = buf.getUint16(2, true);
      else if (type === 0x01) parseState(buf);
      else if (type === 0x03) { if (buf.getUint16(1, true) === myId) onDeath(); }
      else if (type === 0x04) {
        // Kill event — could spawn particles etc
      }
      else if (type === 0x05) parseLeaderboard(buf);
    };
    ws.onclose = () => {
      if (connId === myConnId && running) setTimeout(() => { if (connId === myConnId) connect(name, roomId); }, 2000);
    };
  }

  function parseState(buf) {
    let off = 1;
    const playerCount = buf.getUint16(off, true); off += 2;
    const newPlayers = [];
    for (let i = 0; i < playerCount; i++) {
      const id = buf.getUint16(off, true); off += 2;
      const skin = buf.getUint8(off); off += 1;
      const isBot = buf.getUint8(off) === 1; off += 1;
      const kills = buf.getUint8(off); off += 1;
      const nameLen = buf.getUint8(off); off += 1;
      const name = new TextDecoder().decode(new Uint8Array(buf.buffer, off, nameLen)); off += nameLen;
      const cellCount = buf.getUint8(off); off += 1;
      const cells = [];
      for (let j = 0; j < cellCount; j++) {
        const x = buf.getInt16(off, true);
        const y = buf.getInt16(off + 2, true);
        const mass = buf.getUint16(off + 4, true);
        off += 6;
        cells.push({ x, y, mass });
      }
      newPlayers.push({ id, skin, isBot, kills, name, cells });
    }
    const foodCount = buf.getUint16(off, true); off += 2;
    const newFood = [];
    for (let i = 0; i < foodCount; i++) {
      newFood.push({ x: buf.getInt16(off, true), y: buf.getInt16(off + 2, true), color: buf.getUint8(off + 4), mass: buf.getUint8(off + 5) });
      off += 6;
    }
    const virCount = buf.getUint16(off, true); off += 2;
    const newVir = [];
    for (let i = 0; i < virCount; i++) {
      newVir.push({ x: buf.getInt16(off, true), y: buf.getInt16(off + 2, true), mass: buf.getUint16(off + 4, true) });
      off += 6;
    }
    const ejCount = buf.getUint16(off, true); off += 2;
    const newEj = [];
    for (let i = 0; i < ejCount; i++) {
      newEj.push({ x: buf.getInt16(off, true), y: buf.getInt16(off + 2, true), color: buf.getUint8(off + 4) });
      off += 5;
    }
    players = newPlayers; food = newFood; viruses = newVir; ejected = newEj;
  }

  function parseLeaderboard(buf) {
    let off = 1;
    const count = buf.getUint8(off); off += 1;
    leaderboardEntries.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const id = buf.getUint16(off, true); off += 2;
      const score = buf.getUint16(off, true); off += 2;
      const isBot = buf.getUint8(off) === 1; off += 1;
      const nameLen = buf.getUint8(off); off += 1;
      const name = new TextDecoder().decode(new Uint8Array(buf.buffer, off, nameLen)); off += nameLen;
      const div = document.createElement('div');
      div.className = 'lb-entry' + (id === myId ? ' me' : '');
      const aiBadge = isBot ? '<span class="ai-badge">AI</span>' : '';
      div.innerHTML = `<span>${name}${aiBadge}</span><span>${score}</span>`;
      leaderboardEntries.appendChild(div);
    }
    playerCountEl.textContent = 'Orbs: ' + players.reduce((s, p) => s + p.cells.length, 0);
  }

  function sendDirection() {
    if (!ws || ws.readyState !== WebSocket.OPEN || myId === null) return;
    // Convert mouse screen coords to world coords
    const worldX = (mouseX - canvas.width / 2) / camera.zoom + camera.x;
    const worldY = (mouseY - canvas.height / 2) / camera.zoom + camera.y;
    const buf = new ArrayBuffer(9);
    const v = new DataView(buf);
    v.setUint8(0, 0x01);
    v.setFloat32(1, worldX, true);
    v.setFloat32(5, worldY, true);
    ws.send(buf);
  }

  function sendSplit() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(new Uint8Array([0x04]));
  }
  function sendEject() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(new Uint8Array([0x05]));
  }

  function onDeath() {
    const me = players.find(p => p.id === myId);
    const mass = me ? me.cells.reduce((s, c) => s + c.mass, 0) : 0;
    finalScoreEl.textContent = Math.round(mass);
    deathScreen.style.display = 'flex';
    running = false;
    myId = null;
    disconnect();
  }

  // --- Rendering ---
  function massToRadius(m) { return Math.sqrt(m) * 3.5; }

  function drawStarfield(cx, cy) {
    // Procedural stars based on camera position
    ctx.save();
    const parallax = 0.3;
    const px = cx * parallax, py = cy * parallax;
    const size = 180;
    const startX = Math.floor((px - canvas.width / 2) / size) * size;
    const startY = Math.floor((py - canvas.height / 2) / size) * size;
    const endX = px + canvas.width / 2 + size;
    const endY = py + canvas.height / 2 + size;
    for (let gx = startX; gx <= endX; gx += size) {
      for (let gy = startY; gy <= endY; gy += size) {
        // Deterministic pseudo-random per grid cell
        const h = ((gx * 73856093) ^ (gy * 19349663)) | 0;
        const n = ((h >>> 0) / 0xffffffff);
        const sx = gx + ((h >>> 8) & 0xff) / 255 * size;
        const sy = gy + ((h >>> 16) & 0xff) / 255 * size;
        const r = 0.4 + n * 1.2;
        ctx.fillStyle = `rgba(200,200,255,${0.25 + n * 0.35})`;
        const scrX = sx - px + canvas.width / 2;
        const scrY = sy - py + canvas.height / 2;
        ctx.beginPath();
        ctx.arc(scrX, scrY, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawBorder(cx, cy) {
    const half = MAP_SIZE / 2;
    const sx = -half - cx + canvas.width / (2 * camera.zoom);
    const sy = -half - cy + canvas.height / (2 * camera.zoom);
    ctx.save();
    ctx.strokeStyle = 'rgba(180, 140, 255, 0.35)';
    ctx.lineWidth = 4 / camera.zoom;
    ctx.setLineDash([20 / camera.zoom, 20 / camera.zoom]);
    ctx.strokeRect(-half, -half, MAP_SIZE, MAP_SIZE);
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawFood() {
    const FOOD_COLORS = ['#ff64b4', '#64dcff', '#b48cff', '#ffcc64', '#64ff9f', '#ff9f64', '#ff6464', '#9fff64', '#64ffff', '#ff64ff', '#ffff64', '#6495ff'];
    for (const f of food) {
      const color = FOOD_COLORS[f.color % FOOD_COLORS.length];
      const r = 4 + f.mass * 0.4;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawViruses() {
    for (const v of viruses) {
      const r = massToRadius(v.mass);
      // Spiky virus
      ctx.save();
      ctx.translate(v.x, v.y);
      ctx.rotate(animTime * 0.3);
      ctx.fillStyle = '#4fd04f';
      ctx.strokeStyle = '#2a8a2a';
      ctx.lineWidth = 2;
      const spikes = 20;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const angle = (i / (spikes * 2)) * Math.PI * 2;
        const rr = i % 2 === 0 ? r * 1.15 : r * 0.9;
        const px = Math.cos(angle) * rr;
        const py = Math.sin(angle) * rr;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawEjected() {
    const FOOD_COLORS = ['#ff64b4', '#64dcff', '#b48cff', '#ffcc64', '#64ff9f'];
    for (const e of ejected) {
      ctx.fillStyle = FOOD_COLORS[e.color % FOOD_COLORS.length] || '#fff';
      ctx.beginPath();
      ctx.arc(e.x, e.y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPlayers() {
    // Sort by total mass so small render behind big
    const sorted = [...players].sort((a, b) => {
      const am = a.cells.reduce((s, c) => s + c.mass, 0);
      const bm = b.cells.reduce((s, c) => s + c.mass, 0);
      return am - bm;
    });
    for (const p of sorted) {
      const skin = SKINS[p.skin] || SKINS[0];
      // Draw each cell with smooth radius growth
      for (const c of p.cells) {
        const targetR = massToRadius(c.mass);
        const key = p.id + '_' + (c.id || c.x.toFixed(0));
        let dispR = displayRadius.get(key) || targetR;
        // Smooth growth — expands toward target, never shrinks instantly
        if (targetR > dispR) dispR += (targetR - dispR) * 0.15; // grow smoothly
        else dispR += (targetR - dispR) * 0.3; // shrink a bit faster
        displayRadius.set(key, dispR);
        drawOrb(ctx, c.x, c.y, dispR, skin);
      }
      // Draw name + mass on largest cell
      if (p.cells.length > 0) {
        const biggest = p.cells.reduce((m, c) => c.mass > m.mass ? c : m, p.cells[0]);
        const br = massToRadius(biggest.mass);
        const fontSize = Math.max(12, Math.min(br * 0.35, 28));
        ctx.font = `bold ${fontSize}px "SF Pro Display", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = fontSize * 0.15;
        ctx.strokeText(p.name, biggest.x, biggest.y);
        ctx.fillText(p.name, biggest.x, biggest.y);
        // Mass
        if (biggest.mass > 50) {
          ctx.font = `${fontSize * 0.6}px "SF Pro Display", sans-serif`;
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          ctx.strokeText(Math.round(biggest.mass), biggest.x, biggest.y + fontSize * 0.9);
          ctx.fillText(Math.round(biggest.mass), biggest.x, biggest.y + fontSize * 0.9);
        }
      }
    }
  }

  function drawMinimap(cx, cy) {
    const w = minimapCanvas.width, h = minimapCanvas.height;
    mCtx.clearRect(0, 0, w, h);
    mCtx.fillStyle = 'rgba(10,6,32,0.6)';
    mCtx.fillRect(0, 0, w, h);
    mCtx.strokeStyle = 'rgba(180,140,255,0.3)';
    mCtx.lineWidth = 1;
    mCtx.strokeRect(0, 0, w, h);
    const scale = w / MAP_SIZE;
    const ox = w / 2, oy = h / 2;
    for (const p of players) {
      if (p.cells.length === 0) continue;
      const c = p.cells.reduce((m, x) => x.mass > m.mass ? x : m, p.cells[0]);
      mCtx.fillStyle = p.id === myId ? '#fff' : (SKINS[p.skin] || SKINS[0]).outer;
      mCtx.globalAlpha = p.id === myId ? 1 : 0.6;
      mCtx.beginPath();
      mCtx.arc(c.x * scale + ox, c.y * scale + oy, p.id === myId ? 3 : 2, 0, Math.PI * 2);
      mCtx.fill();
    }
    mCtx.globalAlpha = 1;
  }

  // --- Main loop ---
  let sendTimer = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    animTime += dt;

    if (running) {
      if (gameMode === 'local' && localGame) {
        // Convert mouse to world coords
        const worldX = (mouseX - canvas.width / 2) / camera.zoom + camera.x;
        const worldY = (mouseY - canvas.height / 2) / camera.zoom + camera.y;
        localGame.setPlayerTarget(worldX, worldY);
        localGame.tick(dt);
        players = localGame.players.filter(p => p.alive);
        food = localGame.food;
        viruses = localGame.viruses;
        ejected = localGame.ejected;
        // Local leaderboard
        const sorted = [...players].map(p => ({
          id: p.id, name: p.name, isBot: p.isBot,
          score: p.cells.reduce((s, c) => s + c.mass, 0)
        })).sort((a, b) => b.score - a.score).slice(0, 10);
        leaderboardEntries.innerHTML = '';
        for (const e of sorted) {
          const div = document.createElement('div');
          div.className = 'lb-entry' + (e.id === myId ? ' me' : '');
          const ai = e.isBot ? '<span class="ai-badge">AI</span>' : '';
          div.innerHTML = `<span>${e.name}${ai}</span><span>${Math.round(e.score)}</span>`;
          leaderboardEntries.appendChild(div);
        }
        playerCountEl.textContent = 'Orbs: ' + players.reduce((s, p) => s + p.cells.length, 0);
      } else if (gameMode === 'multiplayer') {
        sendTimer += dt;
        if (sendTimer >= 0.05) { sendDirection(); sendTimer = 0; }
      }

      // Camera follow my cells' centroid
      const me = players.find(p => p.id === myId);
      if (me && me.cells.length > 0) {
        let tx = 0, ty = 0, totalMass = 0;
        for (const c of me.cells) { tx += c.x * c.mass; ty += c.y * c.mass; totalMass += c.mass; }
        tx /= totalMass; ty /= totalMass;
        camera.x += (tx - camera.x) * 0.2;
        camera.y += (ty - camera.y) * 0.2;
        const targetZoom = Math.max(0.35, 1.0 - Math.sqrt(totalMass) * 0.015);
        camera.zoom += (targetZoom - camera.zoom) * 0.05;
        myScoreEl.textContent = 'Mass: ' + Math.round(totalMass);
      }
    }

    // Background
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#03051a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Radial nebula wash
    const grad = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.width * 0.1,
      canvas.width / 2, canvas.height / 2, canvas.width * 0.7);
    grad.addColorStop(0, 'rgba(40, 20, 80, 0.25)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Starfield (screen space)
    drawStarfield(camera.x, camera.y);

    // World transform
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    drawBorder(camera.x, camera.y);
    drawFood();
    drawEjected();
    drawViruses();
    drawPlayers();

    ctx.restore();

    drawMinimap(camera.x, camera.y);
  }
  requestAnimationFrame(frame);

  // --- Menu background — drifting cosmic dust ---
  const bgDust = [];
  for (let i = 0; i < 60; i++) {
    bgDust.push({ x: Math.random() * 2000, y: Math.random() * 2000, r: 1 + Math.random() * 3, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10, color: SKINS[Math.floor(Math.random() * SKINS.length)].outer, alpha: 0.2 + Math.random() * 0.4 });
  }
  function animateBg() {
    requestAnimationFrame(animateBg);
    const inGame = hud.style.display === 'block';
    menuBg.style.display = inGame ? 'none' : 'block';
    if (inGame) return;
    mbCtx.clearRect(0, 0, menuBg.width, menuBg.height);
    for (const d of bgDust) {
      d.x += d.vx * 0.016; d.y += d.vy * 0.016;
      if (d.x < -50) d.x = menuBg.width + 50;
      if (d.x > menuBg.width + 50) d.x = -50;
      if (d.y < -50) d.y = menuBg.height + 50;
      if (d.y > menuBg.height + 50) d.y = -50;
      mbCtx.globalAlpha = d.alpha;
      mbCtx.fillStyle = d.color;
      mbCtx.beginPath();
      mbCtx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      mbCtx.fill();
    }
    mbCtx.globalAlpha = 1;
  }
  requestAnimationFrame(animateBg);

  // --- Online count + server status ---
  function pollOnline() {
    fetch(SERVER_URL + '/api/rooms').then(r => r.json()).then(rooms => {
      let total = 0;
      for (const r of rooms) total += r.players || 0;
      document.getElementById('onlineCount').textContent = total + ' playing';
      if (statusText) statusText.textContent = 'ONLINE';
      if (serverStatus) serverStatus.className = 'status-online';
    }).catch(() => {
      document.getElementById('onlineCount').textContent = '— offline';
      if (statusText) statusText.textContent = 'OFFLINE';
      if (serverStatus) serverStatus.className = 'status-offline';
    });
  }
  pollOnline();
  setInterval(pollOnline, 5000);
})();
