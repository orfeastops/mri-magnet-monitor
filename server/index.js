require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const db = require('./db');

// ========== AUTH ==========
const APP_PASSWORD = process.env.APP_PASSWORD || 'magnets';
const REMEMBER_ME_DAYS = 30;
// ==========================

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-in-env-file',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

// --- Login / Logout (no auth required) ---
app.get('/login', (req, res) => {
  if (req.session.authenticated) return res.redirect('/');
  res.sendFile(path.join(__dirname, '../webapp/login.html'));
});

app.post('/login', (req, res) => {
  if (req.body.password === APP_PASSWORD) {
    req.session.authenticated = true;
    if (req.body.remember) {
      req.session.cookie.maxAge = REMEMBER_ME_DAYS * 24 * 60 * 60 * 1000;
    }
    res.redirect('/');
  } else {
    res.redirect('/login?error=1');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// --- Auth middleware (protects everything below) ---
function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  res.redirect('/login');
}
app.use(requireAuth);

// --- Protected static files & API ---
app.use(express.static(path.join(__dirname, '../webapp')));

const devices = new Map();

// Ping all clients every 10s — terminate unresponsive ones within ~20s
const pingInterval = setInterval(() => {
  wss.clients.forEach(client => {
    if (client.isAlive === false) { client.terminate(); return; }
    client.isAlive = false;
    client.ping();
  });
}, 10000);
wss.on('close', () => clearInterval(pingInterval));

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  let deviceMac = null;
  let isESP = false;
  let isBrowser = false;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'esp_hello') {
      isESP = true;
      deviceMac = msg.mac;
      const existing = db.getDevice(deviceMac);
      if (!existing) {
        db.addDevice(deviceMac, null);
        broadcastToBrowsers({ type: 'new_device', mac: deviceMac });
      }
      if (!devices.has(deviceMac)) {
        devices.set(deviceMac, { ws, name: existing?.name || null, browsers: [] });
      } else {
        devices.get(deviceMac).ws = ws;
      }
      console.log(`[ESP] Connected: ${deviceMac} (${existing?.name || 'UNNAMED'})`);
    }

    if (msg.type === 'serial_data' && deviceMac) {
      db.saveData(deviceMac, msg.data);
      const dev = devices.get(deviceMac);
      if (dev) {
        dev.browsers.forEach(bws => {
          if (bws.readyState === WebSocket.OPEN) {
            bws.send(JSON.stringify({ type: 'serial_data', mac: deviceMac, data: msg.data, ts: new Date().toISOString() }));
          }
        });
      }
    }

    if (msg.type === 'browser_hello') isBrowser = true;

    if (msg.type === 'watch' && isBrowser) {
      const dev = devices.get(msg.mac);
      if (dev && !dev.browsers.includes(ws)) dev.browsers.push(ws);
    }

    if (msg.type === 'command') {
      const dev = devices.get(msg.mac);
      if (dev && dev.ws.readyState === WebSocket.OPEN) {
        dev.ws.send(JSON.stringify({ type: 'command', cmd: msg.cmd }));
      }
    }

    if (msg.type === 'name_device') {
      db.nameDevice(msg.mac, msg.name);
      const dev = devices.get(msg.mac);
      if (dev) dev.name = msg.name;
      broadcastToBrowsers({ type: 'device_named', mac: msg.mac, name: msg.name });
      console.log(`[DB] Device ${msg.mac} named: ${msg.name}`);
    }
  });

  ws.on('close', (code, reason) => {
    if (isESP && deviceMac) {
      console.log(`[ESP] Disconnected: ${deviceMac} code=${code} reason=${reason && reason.toString()}`);
      devices.delete(deviceMac);
      try { broadcastToBrowsers({ type: 'device_offline', mac: deviceMac }); }
      catch(e) { console.log('[ESP] broadcastToBrowsers error:', e.message); }
    }
    if (isBrowser) {
      devices.forEach(dev => {
        dev.browsers = dev.browsers.filter(b => b !== ws);
      });
    }
  });
});

function broadcastToBrowsers(msg) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  });
}

app.get('/api/devices', (req, res) => {
  const devs = db.getAllDevices();
  devs.forEach(d => d.online = devices.has(d.mac));
  res.json(devs);
});

app.get('/api/history/:mac', (req, res) => {
  const rows = db.getHistory(req.params.mac, 100);
  res.json(rows);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`MRI Monitor running on http://localhost:${PORT}`));
