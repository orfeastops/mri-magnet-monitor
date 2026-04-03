const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../webapp')));

const devices = new Map();

wss.on('connection', (ws) => {
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

  ws.on('close', () => {
    if (isESP && deviceMac) {
      devices.delete(deviceMac);
      broadcastToBrowsers({ type: 'device_offline', mac: deviceMac });
      console.log(`[ESP] Disconnected: ${deviceMac}`);
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
