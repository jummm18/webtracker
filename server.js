// ==============================
// SERVER UTAMA - Tracker Sampah Plastik Laut
// Tesis Jumantoro L1C022006 - UNSOED
// ==============================

require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mqtt = require('mqtt');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// === CORS ===
app.use(cors({
  origin: 'https://trackerfpikunsoed.my.id', // pastikan tidak ada spasi!
  methods: ['GET', 'POST'],
  credentials: true
}));

// === Konfigurasi dari .env ===
const CONFIG = {
  PORT: parseInt(process.env.PORT) || 3000,
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_USER: process.env.DB_USER,
  DB_PASS: process.env.DB_PASS,
  DB_NAME: process.env.DB_NAME,
  MQTT_BROKER: process.env.MQTT_BROKER || 'mqtt://localhost:1883',
  MQTT_GPS_TOPIC: process.env.MQTT_GPS_TOPIC || 'tracker/gps',
  MQTT_CONTROL_TOPIC: process.env.MQTT_CONTROL_TOPIC || 'tracker/control/all'
};

let db;

// === Koneksi MySQL ===
async function connectDB() {
  try {
    db = await mysql.createConnection({
      host: CONFIG.DB_HOST,
      user: CONFIG.DB_USER,
      password: CONFIG.DB_PASS,
      database: CONFIG.DB_NAME
    });
    console.log('✅ MySQL connected to', CONFIG.DB_NAME);
    db.on('error', (err) => {
      if (err.code === 'PROTOCOL_CONNECTION_LOST') {
        console.log('🔁 Reconnecting MySQL...');
        setTimeout(connectDB, 2000);
      } else {
        throw err;
      }
    });
  } catch (e) {
    console.error('❌ MySQL connection error:', e.message);
    setTimeout(connectDB, 5000);
  }
}

// === Koneksi MQTT ===
const mqttClient = mqtt.connect(CONFIG.MQTT_BROKER, {
  reconnectPeriod: 5000,
  clientId: 'server-tracker-' + Math.random().toString(16).substr(2, 8)
});

mqttClient.on('connect', () => {
  console.log('✅ MQTT connected to:', CONFIG.MQTT_BROKER);
  mqttClient.subscribe(CONFIG.MQTT_GPS_TOPIC, (err) => {
    if (err) {
      console.error('❌ MQTT subscribe failed:', err);
    } else {
      console.log('📡 Subscribed to:', CONFIG.MQTT_GPS_TOPIC);
    }
  });
});

mqttClient.on('message', async (topic, payload) => {
  if (topic !== CONFIG.MQTT_GPS_TOPIC) return;
  try {
    const data = JSON.parse(payload.toString());
    if (!data.device_id || isNaN(parseFloat(data.latitude)) || isNaN(parseFloat(data.longitude))) {
      console.warn('⚠️ Invalid GPS data ignored:', payload.toString());
      return;
    }

    const lat = parseFloat(data.latitude);
    const lon = parseFloat(data.longitude);
    let waktu_gps = new Date().toISOString();
    if (data.waktu_gps) {
      const parsed = new Date(data.waktu_gps);
      if (!isNaN(parsed.getTime())) {
        waktu_gps = parsed.toISOString();
      }
    }

    await db.execute(
      'INSERT INTO tracker_gps (device_id, latitude, longitude, waktu_gps) VALUES (?, ?, ?, ?)',
      [data.device_id, lat, lon, new Date(waktu_gps)]
    );

    io.emit('newLocation', {
      device_id: data.device_id,
      latitude: lat,
      longitude: lon,
      waktu: waktu_gps
    });

    console.log(`📍 [MQTT] ${data.device_id} → ${lat}, ${lon} at ${waktu_gps}`);
  } catch (e) {
    console.error('❌ MQTT parse error:', e.message);
  }
});

// === API: Download data 24 jam (WIB) ===
app.get('/api/download-last-24h', async (req, res) => {
  try {
    const nowWIB = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const cutoffUTC = new Date(nowWIB.getTime() - 24 * 60 * 60 * 1000 - 7 * 60 * 60 * 1000);

    const [rows] = await db.execute(
      `SELECT device_id, latitude, longitude, waktu_gps, waktu
       FROM tracker_gps
       WHERE waktu >= ?
       ORDER BY waktu DESC`,
      [cutoffUTC]
    );

    const csv = [
      'device_id,latitude,longitude,waktu_gps_wib,waktu_db_wib',
      ...rows.map(r => {
        const gpsWIB = new Date(new Date(r.waktu_gps).getTime() + 7 * 60 * 60 * 1000);
        const dbWIB = new Date(new Date(r.waktu).getTime() + 7 * 60 * 60 * 1000);
        const gpsStr = gpsWIB.toISOString().replace('T', ' ').replace('.000Z', '');
        const dbStr = dbWIB.toISOString().replace('T', ' ').replace('.000Z', '');
        return `"${r.device_id}",${r.latitude},${r.longitude},"${gpsStr}","${dbStr}"`;
      })
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tracker_data_24h_wib.csv"');
    res.send('\uFEFF' + csv);
  } catch (err) {
    console.error('❌ CSV Export Error:', err);
    res.status(500).send('Gagal mengunduh data');
  }
});

// === API: Lokasi terbaru semua device ===
app.get('/api/latest-devices', async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT t1.device_id, t1.latitude, t1.longitude, t1.waktu_gps
      FROM tracker_gps t1
      INNER JOIN (
        SELECT device_id, MAX(waktu_gps) AS max_time
        FROM tracker_gps
        WHERE device_id IS NOT NULL AND device_id != '' AND waktu_gps IS NOT NULL
        GROUP BY device_id
      ) t2 
      ON t1.device_id = t2.device_id AND t1.waktu_gps = t2.max_time
      WHERE t1.waktu_gps IS NOT NULL
      ORDER BY t1.waktu_gps DESC
    `);

    const formatted = rows.map(row => ({
      device_id: row.device_id,
      latitude: parseFloat(row.latitude),
      longitude: parseFloat(row.longitude),
      waktu_gps: new Date(row.waktu_gps).toISOString()
    }));

    res.json(formatted);
  } catch (err) {
    console.error('❌ Gagal ambil data terakhir:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// === API: Histori per device ===
app.get('/api/history', async (req, res) => {
  const { device_id, interval = 60, hours = 24 } = req.query;

  if (!device_id) {
    return res.status(400).json({ error: 'device_id required' });
  }

  const intervalSec = parseInt(interval);
  const hoursNum = parseInt(hours);

  if (isNaN(intervalSec) || intervalSec < 1 || intervalSec > 86400) {
    return res.status(400).json({ error: 'Invalid interval (1–86400 seconds)' });
  }
  if (isNaN(hoursNum) || hoursNum < 1 || hoursNum > 168) {
    return res.status(400).json({ error: 'Hours must be 1–168 (7 days)' });
  }

  try {
    const cutoff = new Date(Date.now() - hoursNum * 60 * 60 * 1000);
    const [rows] = await db.execute(`
      SELECT device_id, latitude, longitude, waktu_gps
      FROM tracker_gps
      WHERE device_id = ? AND waktu_gps >= ?
      ORDER BY waktu_gps ASC
    `, [device_id, cutoff]);

    let lastTimestamp = 0;
    const filtered = [];

    for (const row of rows) {
      const sec = Math.floor(new Date(row.waktu_gps).getTime() / 1000);
      if (lastTimestamp === 0 || sec - lastTimestamp >= intervalSec) {
        filtered.push({
          device_id: row.device_id,
          latitude: parseFloat(row.latitude),
          longitude: parseFloat(row.longitude),
          waktu_gps: new Date(row.waktu_gps).toISOString()
        });
        lastTimestamp = sec;
      }
    }

    res.json(filtered);
  } catch (err) {
    console.error('❌ History error:', err);
    res.status(500).json({ error: 'Failed to load historical data' });
  }
});

// === Static files (login.html, index.html, assets) ===
app.use(express.static('public'));

// === Socket.IO: Kontrol perangkat ===
io.on('connection', (socket) => {
  socket.on('setIntervalToDevice', (data) => {
    const { deviceId, interval } = data;
    if (!deviceId || typeof interval !== 'number' || interval < 1000) {
      socket.emit('commandResponse', { message: '❌ Interval minimal 1000 ms (1 detik).' });
      return;
    }
    const payload = JSON.stringify({ command: 'set_interval', interval, target: deviceId });
    mqttClient.publish(CONFIG.MQTT_CONTROL_TOPIC, payload, { qos: 0 }, (err) => {
      if (err) {
        socket.emit('commandResponse', { message: '❌ Gagal kirim ke perangkat' });
      } else {
        socket.emit('commandResponse', { message: `✅ Interval diatur ke ${interval/1000} detik` });
      }
    });
  });

  socket.on('ledControl', (data) => {
    const { deviceId, state } = data;
    if (!deviceId || !['on', 'off'].includes(state)) {
      socket.emit('commandResponse', { message: '❌ Perintah LED tidak valid.' });
      return;
    }
    const payload = JSON.stringify({ command: 'led', state, target: deviceId });
    mqttClient.publish(CONFIG.MQTT_CONTROL_TOPIC, payload, { qos: 0 }, (err) => {
      if (err) {
        socket.emit('commandResponse', { message: `❌ Gagal kirim LED ke ${deviceId}` });
      } else {
        socket.emit('commandResponse', { message: `✅ LED ${state} untuk ${deviceId}` });
      }
    });
  });
});

// === Redirect root ke login ===
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// === Jalankan server ===
server.listen(CONFIG.PORT, () => {
  console.log(`🚀 Server berjalan di http://localhost:${CONFIG.PORT}`);
  console.log(`🌐 Akses: https://trackerfpikunsoed.my.id`);
  connectDB();
});

// === Graceful shutdown ===
process.on('SIGINT', async () => {
  console.log('\n🛑 Menutup koneksi...');
  mqttClient.end();
  if (db) await db.end();
  server.close(() => {
    console.log('👋 Server berhenti.');
    process.exit(0);
  });
});