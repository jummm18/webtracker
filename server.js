// ==============================
// SERVER UTAMA - Tracker Sampah Plastik Laut
// Tesis Jumantoro L1C022006 - UNSOED
// Login via Google OAuth + IoT Tracker
// ==============================

require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mqtt = require('mqtt');
const mysql = require('mysql2/promise');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// === CORS ===
app.use(cors({
  origin: ['https://trackerfpikunsoed.my.id', 'http://localhost:3000'],
  methods: ['GET', 'POST'],
  credentials: true
}));

// === Session & Passport Setup (untuk Google OAuth) ===
app.use(session({
  secret: process.env.SESSION_SECRET || 'gps-tracker-session-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 jam
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// === Serialization ===
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// === Google OAuth Strategy (diperbarui untuk simpan data lengkap) ===
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "https://trackerfpikunsoed.my.id/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails?.[0]?.value?.toLowerCase();
    if (!email) {
      return done(null, false, { message: 'Email tidak tersedia dari Google.' });
    }

    const allowedDomains = ['@mhs.unsoed.ac.id', '@unsоed.ac.id'];
    const isValidDomain = allowedDomains.some(domain => email.endsWith(domain));
    if (!isValidDomain) {
      return done(null, false, { message: 'Hanya email dari UNSOED yang diizinkan.' });
    }

    const username = email.split('@')[0];
    const full_name = profile.displayName || username;
    const google_id = profile.id;

    // Simpan atau update user
    await db.execute(`
      INSERT INTO users (username, full_name, google_id, email, last_login)
      VALUES (?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        full_name = VALUES(full_name),
        google_id = VALUES(google_id),
        last_login = NOW()
    `, [username, full_name, google_id, email]);

    return done(null, { email, full_name });
  } catch (err) {
    console.error('Google OAuth DB Error:', err.message);
    return done(err);
  }
}));

// === Middleware ===
app.use(express.json());
app.use(express.static('public'));

// === Konfigurasi ===
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

// === Rute OAuth Google ===
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/login.html?error=unauthorized'
  }),
  (req, res) => {
    res.redirect('/auth/success');
  }
);

// Halaman sukses: set localStorage dengan data lengkap
app.get('/auth/success', (req, res) => {
  const user = req.session.passport?.user;
  if (!user || !user.email) {
    return res.redirect('/login.html?error=session');
  }

  const { email, full_name } = user;
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Login Berhasil</title></head>
    <body style="font-family: sans-serif; text-align: center; padding: 40px;">
      <h2>✅ Login Berhasil</h2>
      <p>Mengalihkan ke dashboard...</p>
      <script>
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('userEmail', '${email}');
        localStorage.setItem('userFullName', '${full_name || email}');
        window.location.href = '/index.html';
      </script>
    </body>
    </html>
  `);
});

// Logout
app.post('/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Gagal logout' });
    res.json({ success: true });
  });
});

// === MQTT & Fitur IoT ===
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

// === API IoT ===
// === API DOWNLOAD 24 JAM (WIB) ===
app.get('/api/download-last-24h', async (req, res) => {
  try {
    // WIB sekarang
    const nowWIB = new Date(Date.now() + 7 * 60 * 60 * 1000);

    // Cutoff 24 jam terakhir (UTC)
    const cutoffUTC = new Date(
      nowWIB.getTime() - 24 * 60 * 60 * 1000 - 7 * 60 * 60 * 1000
    );

    const [rows] = await db.execute(
      `SELECT 
         device_id,
         latitude,
         longitude,
         waktu_gps,
         waktu
       FROM tracker_gps
       WHERE waktu >= ?
       ORDER BY waktu DESC`,
      [cutoffUTC]
    );

    // Helper format tanggal WIB seragam
    const formatWIB = (date) =>
      new Date(date.getTime() + 7 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ');

    // Generate CSV
    const csv = [
      'waktu_gps_wib,waktu_db_wib,device_id,latitude,longitude',
      ...rows.map(r => {
        const gpsStr = formatWIB(new Date(r.waktu_gps));
        const dbStr  = formatWIB(new Date(r.waktu));

        return `"${gpsStr}","${dbStr}","${r.device_id}",${r.latitude},${r.longitude}`;
      })
    ].join('\n');

    // Response header
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="tracker_data_24h_wib.csv"'
    );

    // BOM agar Excel tidak rusak
    res.send('\uFEFF' + csv);

  } catch (err) {
    console.error('❌ CSV Export Error:', err);
    res.status(500).send('Gagal mengunduh data');
  }
});


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

app.get('/api/history', async (req, res) => {
  const { device_id, interval = 60, hours = 24 } = req.query;
  if (!device_id) return res.status(400).json({ error: 'device_id required' });

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

// === Socket.IO (TETAP SAMA) ===
io.on('connection', (socket) => {
  socket.on('setIntervalToDevice', (data) => {
    const { deviceId, interval } = data;
    if (!deviceId || typeof interval !== 'number' || interval < 1000) {
      socket.emit('commandResponse', { message: '❌ Interval minimal 1000 ms (1 detik).' });
      return;
    }
    const payload = JSON.stringify({ command: 'set_interval', interval, target: deviceId });
    mqttClient.publish(CONFIG.MQTT_CONTROL_TOPIC, payload, { qos: 0 }, (err) => {
      if (err) socket.emit('commandResponse', { message: '❌ Gagal kirim ke perangkat' });
      else socket.emit('commandResponse', { message: `✅ Interval diatur ke ${interval/1000} detik` });
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
      if (err) socket.emit('commandResponse', { message: `❌ Gagal kirim LED ke ${deviceId}` });
      else socket.emit('commandResponse', { message: `✅ LED ${state} untuk ${deviceId}` });
    });
  });
});

// === Static & Redirect Root ===
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// === Jalankan Server ===
server.listen(CONFIG.PORT, '0.0.0.0', () => {
  console.log(`🚀 Server berjalan di http://202.10.40.237:${CONFIG.PORT}`);
  console.log(`🌐 Akses: https://trackerfpikunsoed.my.id`);
  connectDB();
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Menutup koneksi...');
  mqttClient.end();
  if (db) await db.end();
  server.close(() => {
    console.log('👋 Server berhenti.');
    process.exit(0);
  });
});
