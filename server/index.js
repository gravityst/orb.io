const express = require('express');
const http = require('http');
const { RoomManager } = require('./game');

const app = express();
const server = http.createServer(app);
app.use(express.json());

// CORS — allow GitHub Pages and any origin to reach the API
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST');
  next();
});

const roomManager = new RoomManager(server);

app.get('/api/rooms', (req, res) => {
  res.json(roomManager.getRoomList());
});

app.post('/api/rooms', (req, res) => {
  const { name } = req.body;
  if (!name || name.length > 24) return res.status(400).json({ error: 'Invalid name' });
  if (roomManager.rooms.size > 50) return res.status(400).json({ error: 'Too many rooms' });
  const room = roomManager.createCustomRoom(name);
  res.json({ id: room.id, name: room.name, code: room.code });
});

app.get('/api/rooms/code/:code', (req, res) => {
  for (const [id, room] of roomManager.rooms) {
    if (room.code === req.params.code.toUpperCase()) {
      return res.json({ id, name: room.name });
    }
  }
  res.status(404).json({ error: 'Room not found' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Orb.io WebSocket server running on port ${PORT}`);
  console.log(`  Rooms: ${roomManager.rooms.size}`);
});
