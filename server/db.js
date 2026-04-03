const Database = require('better-sqlite3');
const db = new Database('database.sqlite');

db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    mac TEXT PRIMARY KEY,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS data_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mac TEXT,
    raw TEXT,
    ts DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

module.exports = {
  getDevice: (mac) => db.prepare('SELECT * FROM devices WHERE mac=?').get(mac),
  getAllDevices: () => db.prepare('SELECT * FROM devices').all(),
  addDevice: (mac, name) => db.prepare('INSERT OR IGNORE INTO devices (mac,name) VALUES (?,?)').run(mac, name),
  nameDevice: (mac, name) => db.prepare('UPDATE devices SET name=? WHERE mac=?').run(name, mac),
  saveData: (mac, raw) => db.prepare('INSERT INTO data_log (mac,raw) VALUES (?,?)').run(mac, raw),
  getHistory: (mac, limit) => db.prepare('SELECT * FROM data_log WHERE mac=? ORDER BY ts DESC LIMIT ?').all(mac, limit),
};

