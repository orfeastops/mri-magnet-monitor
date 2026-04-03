const WS_URL = `wss://${location.host}`;
let ws, currentMac = null;
let pendingNewDevice = null;
let term = null;
let fitAddon = null;
let rawBuffer = '';
let namingQueue = [];

function initTerminal() {
  if (term) term.dispose();
  term = new Terminal({
    theme: { background: '#000000', foreground: '#00ff88', cursor: '#00ff88' },
    fontFamily: '"Courier New", monospace',
    fontSize: 13,
    convertEol: false,
    cursorBlink: true,
    scrollback: 2000,
  });
  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal-container'));
  setTimeout(() => fitAddon.fit(), 50);
  term.onKey(({ key }) => {
    if (currentMac && ws) {
      ws.send(JSON.stringify({ type: 'command', mac: currentMac, cmd: key }));
    }
  });
  window.addEventListener('resize', () => { if (fitAddon) fitAddon.fit(); });
}

function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    setStatus('online');
    ws.send(JSON.stringify({ type: 'browser_hello' }));
    loadDevices();
  };
  ws.onclose = () => { setStatus('offline'); setTimeout(connect, 3000); };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'serial_data' && msg.mac === currentMac) {
      if (term) term.write(msg.data + '\r\n');
      rawBuffer += msg.data + '\n';
      updateDashboard(rawBuffer);
    }
    if (msg.type === 'new_device') {
      enqueueNaming(msg.mac);
      loadDevices();
    }
    if (msg.type === 'device_named' || msg.type === 'device_offline') loadDevices();
  };
}

function setStatus(s) {
  const el = document.getElementById('conn-status');
  el.textContent = s === 'online' ? 'Online' : 'Offline';
  el.className = `badge ${s}`;
}

async function loadDevices() {
  const devs = await fetch('/api/devices').then(r => r.json());
  const c = document.getElementById('devices');
  c.innerHTML = devs.length === 0
    ? '<p style="color:#444;font-size:13px">Δεν υπάρχουν μηχανήματα ακόμα.</p>'
    : devs.map(d => `
      <div class="device-card" onclick="openMagnet('${d.mac}','${d.name || d.mac}',${d.online})">
        <div class="dev-name">${d.name || '<span class="unnamed">Αχαρακτήριστο</span>'}</div>
        <div class="dev-mac">${d.mac}</div>
        <div class="${d.online ? 'dev-online' : 'dev-offline'}">
          ${d.online ? '● Online' : '○ Offline'}
        </div>
      </div>`).join('');

  // Prompt naming for any unnamed devices not already in queue
  devs.filter(d => !d.name).forEach(d => enqueueNaming(d.mac));
}

// --- Naming queue ---
function enqueueNaming(mac) {
  if (namingQueue.includes(mac)) return;
  namingQueue.push(mac);
  if (namingQueue.length === 1) showNamingModal();
}

function showNamingModal() {
  if (namingQueue.length === 0) return;
  const mac = namingQueue[0];
  pendingNewDevice = mac;
  document.getElementById('modal-mac').textContent = `MAC: ${mac}`;
  document.getElementById('modal-name').value = '';
  const queueInfo = document.getElementById('modal-queue-info');
  queueInfo.textContent = namingQueue.length > 1
    ? `+ ${namingQueue.length - 1} ακόμα συσκευή σε αναμονή`
    : '';
  document.getElementById('modal-new-device').style.display = 'flex';
  setTimeout(() => document.getElementById('modal-name').focus(), 50);
}

function closeNamingModal() {
  document.getElementById('modal-new-device').style.display = 'none';
  pendingNewDevice = null;
}

document.getElementById('modal-save').onclick = () => {
  const name = document.getElementById('modal-name').value.trim();
  if (!name || !pendingNewDevice) return;
  ws.send(JSON.stringify({ type: 'name_device', mac: pendingNewDevice, name }));
  namingQueue.shift();
  closeNamingModal();
  loadDevices();
  if (namingQueue.length > 0) setTimeout(showNamingModal, 300);
};

document.getElementById('modal-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('modal-save').click();
});

document.getElementById('modal-later').onclick = () => {
  namingQueue.shift();
  closeNamingModal();
  if (namingQueue.length > 0) setTimeout(showNamingModal, 300);
};

// --- Rest of app ---
function openMagnet(mac, name, online) {
  currentMac = mac;
  rawBuffer = '';
  document.getElementById('view-devices').style.display = 'none';
  document.getElementById('view-magnet').style.display = 'block';
  document.getElementById('magnet-title').textContent = name;
  const badge = document.getElementById('magnet-online');
  badge.textContent = online ? 'Online' : 'Offline';
  badge.className = `badge ${online ? 'online' : 'offline'}`;
  switchTab('terminal', document.querySelector('.tab[data-tab="terminal"]'));
  ws.send(JSON.stringify({ type: 'watch', mac }));
  setTimeout(() => {
    initTerminal();
    fetch(`/api/history/${mac}`).then(r => r.json()).then(rows => {
      rows.reverse().forEach(r => {
        if (term) term.write(r.raw + '\r\n');
        rawBuffer += r.raw + '\n';
      });
      if (rawBuffer) updateDashboard(rawBuffer);
    });
  }, 100);
}

function sendCmd(cmd) {
  if (!currentMac || !ws) return;
  ws.send(JSON.stringify({ type: 'command', mac: currentMac, cmd }));
  if (term) {
    const label = cmd === '\x1B' ? 'ESC' : cmd.replace('\r', '');
    term.write(`\r\n\x1b[33m> ${label}\x1b[0m\r\n`);
  }
}

document.getElementById('manual-send').onclick = () => {
  const inp = document.getElementById('manual-cmd');
  const cmd = inp.value.trim();
  if (!cmd) return;
  sendCmd(cmd + '\r');
  inp.value = '';
};
document.getElementById('manual-cmd').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('manual-send').click();
});

document.getElementById('save-btn').onclick = () => {
  const blob = new Blob([rawBuffer], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `magnet_${currentMac}_${new Date().toISOString()}.txt`;
  a.click();
};

document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => switchTab(btn.dataset.tab, btn);
});

function switchTab(name, btn) {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tabcontent').forEach(t => t.style.display = 'none');
  if (btn) btn.classList.add('active');
  else document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');
  document.getElementById(`tab-${name}`).style.display = 'flex';
  if (name === 'terminal' && fitAddon) setTimeout(() => fitAddon.fit(), 50);
}

// --- ⋮ Menu & Rename ---
document.getElementById('menu-btn').onclick = (e) => {
  e.stopPropagation();
  const dd = document.getElementById('menu-dropdown');
  dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
};
document.addEventListener('click', () => {
  document.getElementById('menu-dropdown').style.display = 'none';
});

document.getElementById('rename-btn').onclick = () => {
  document.getElementById('menu-dropdown').style.display = 'none';
  const current = document.getElementById('magnet-title').textContent;
  const input = document.getElementById('rename-input');
  input.value = current !== currentMac ? current : '';
  document.getElementById('modal-rename').style.display = 'flex';
  setTimeout(() => input.focus(), 50);
};
document.getElementById('rename-cancel').onclick = () => {
  document.getElementById('modal-rename').style.display = 'none';
};
document.getElementById('rename-save').onclick = () => {
  const name = document.getElementById('rename-input').value.trim();
  if (!name || !currentMac) return;
  ws.send(JSON.stringify({ type: 'name_device', mac: currentMac, name }));
  document.getElementById('magnet-title').textContent = name;
  document.getElementById('modal-rename').style.display = 'none';
};
document.getElementById('rename-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('rename-save').click();
  if (e.key === 'Escape') document.getElementById('rename-cancel').click();
});

document.getElementById('back-btn').onclick = () => {
  currentMac = null;
  if (term) { term.dispose(); term = null; }
  document.getElementById('view-magnet').style.display = 'none';
  document.getElementById('view-devices').style.display = 'block';
  loadDevices();
};

function updateDashboard(raw) {
  const grid = document.getElementById('parsed-grid');
  const faultsEl = document.getElementById('faults-box');
  const fields = [
    { label: 'He Level',      regex: /Values\s+(\w+)/ },
    { label: 'Compressor',    regex: /Compressor:\s+(\w+)/ },
    { label: 'Cold Head',     regex: /Cold Head Sensor1:([\d.]+K)/ },
    { label: 'Shield S1',     regex: /Shield\s+Sensor1:([\d.]+K)/ },
    { label: 'Shield S2',     regex: /Shield\s+Sensor1:[\d.]+K\s+Sensor2:([\d.]+K)/ },
    { label: 'Turret S1',     regex: /Turret\s+Sensor1:([\d.]+K)/ },
    { label: 'Mag psiA',      regex: /Mag psiA\s+:([\d.]+)/ },
    { label: 'Avg Power',     regex: /Average Power\s+:([\d.]+W)/ },
    { label: 'Self Test',     regex: /Self Test:\s+(\w+)/ },
    { label: 'Field Current', regex: /Field current\s+([\d.]+A)/ },
    { label: 'Battery Volts', regex: /Volts\s+([\d.]+)/ },
    { label: 'He Status',     regex: /He:\s+(\w+)/ },
  ];
  const cards = fields.map(f => {
    const m = raw.match(f.regex);
    if (!m) return '';
    const v = m[1];
    const isAlarm = v.includes('ALARM') || v.includes('FAULT') || v === 'FAIL' || v === '00.00';
    const isWarn  = v === 'OFF' || v.includes('WARN') || v === 'LOW';
    return `<div class="pcard"><div class="plabel">${f.label}</div><div class="pvalue ${isAlarm ? 'alarm' : isWarn ? 'warn' : ''}">${v}</div></div>`;
  }).join('');
  if (cards) grid.innerHTML = cards;
  const faults = [];
  if (raw.includes('LOAD ALARM')) faults.push('Battery: Load Alarm');
  if (raw.includes('TOO FEW BUTTONS')) faults.push('ERDU: Too Few Buttons');
  if (raw.includes('Alarmbox Communications Fault')) faults.push('Alarmbox Communications Fault');
  if (raw.match(/Sensor2:[\d.]+K\s+WARN/)) faults.push('Shield Sensor2: Warning');
  if (raw.includes('Compressor: OFF')) faults.push('Compressor είναι OFF');
  faultsEl.innerHTML = faults.length > 0
    ? faults.map(f => `<div class="fault-item">⚠️ ${f}</div>`).join('')
    : '<div class="no-faults">✅ Δεν υπάρχουν faults</div>';
}

connect();
