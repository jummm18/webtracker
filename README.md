
# 🌊 Dashboard Pemantauan Tracker Sampah Plastik Laut

> **Proyek Skripsi – Program Studi Ilmu Kelautan, Universitas Jenderal Soedirman**  
> Oleh: **Jumantoro (NIM: L1C022006)**  
> Tahun: 2025  

Dashboard berbasis web untuk memantau lokasi real-time perangkat pelacak sampah plastik di perairan menggunakan IoT, GPS, MQTT, dan teknologi web modern.

![Dashboard Preview](<img width="1919" height="1087" alt="image" src="https://github.com/user-attachments/assets/773858db-0dab-48ce-8b03-1ea4f34e9d42" />
)

---

## 📌 Fitur Utama

- 📍 **Pemantauan Lokasi Real-Time** via peta interaktif (Leaflet.js)
- 📡 **Komunikasi IoT** melalui protokol MQTT
- 🔌 **Kontrol Perangkat Jarak Jauh**:
  - Nyalakan/mati LED indikator
  - Atur interval pengiriman data GPS
- 📊 **Visualisasi Data Historis** per perangkat
- 📥 **Unduh Data** dalam format CSV (24 jam terakhir, zona waktu WIB)
- 📱 **Desain Responsif** – bisa diakses dari HP, tablet, atau desktop
- 🎨 **UI/UX Kustom** dengan ilustrasi dan tata letak yang informatif

---

## 🛠️ Teknologi yang Digunakan

### Backend
- **Node.js** + **Express.js** (server web)
- **Socket.IO** (komunikasi real-time antara server dan frontend)
- **MQTT** (komunikasi dengan perangkat IoT)
- **MySQL** (penyimpanan data GPS dan status perangkat)

### Frontend
- **HTML5**, **CSS3**, **JavaScript (ES6+)**
- **Leaflet.js** (peta interaktif)
- **Custom SVG Markers** (ikon pelacak kustom)

### Infrastruktur
- **VPS (Ubuntu)** – untuk hosting server dan database
- **Mosquitto MQTT Broker** – untuk komunikasi IoT
- **Nginx** (opsional) – sebagai reverse proxy dan SSL

---

## 📁 Struktur Proyek

```
webtracker/
├── public/                 # File frontend (HTML, CSS, JS, assets)
│   ├── login.html
│   ├── index.html
│   └── assets/
│       ├── images/
│       └── ...
├── server.js               # Server utama (Express + Socket.IO + MQTT + MySQL)
├── .env                    # Konfigurasi sensitif (tidak diupload ke GitHub!)
├── .gitignore              # Mencegah upload file sensitif
├── package.json
└── README.md
```

---

## ⚙️ Instalasi & Konfigurasi

### Prasyarat
- Node.js (v18+)
- npm atau yarn
- MySQL server
- MQTT Broker (misal: Mosquitto)

### Langkah-langkah

1. **Clone repositori**
   ```bash
   git clone https://github.com/jummm18/webtracker.git
   cd webtracker
   ```

2. **Instal dependensi**
   ```bash
   npm install
   ```

3. **Buat file `.env`** di root proyek (contoh):
   ```env
   DB_HOST=localhost
   DB_USER=gps123
   DB_PASS=tracking
   DB_NAME=tracking
   PORT=3000
   MQTT_BROKER=mqtt://trackerfpikunsoed.my.id:1884
   MQTT_GPS_TOPIC=tracker/saya
   MQTT_CONTROL_TOPIC=tracker/control/semua
   ```

4. **Buat database dan tabel di MySQL**
   ```sql
   CREATE DATABASE trackerdb;
   USE trackerdb;
   CREATE TABLE tracking (
     id INT AUTO_INCREMENT PRIMARY KEY,
     device_id VARCHAR(50) NOT NULL,
     latitude DECIMAL(10, 8) NOT NULL,
     longitude DECIMAL(11, 8) NOT NULL,
     waktu_gps DATETIME NOT NULL,
     waktu TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );
   ```

5. **Jalankan server**
   ```bash
   node server.js
   ```

6. **Akses aplikasi**
   - Lokal: `http://localhost:3000`
   - Publik: [https://trackerfpikunsoed.my.id](https://trackerfpikunsoed.my.id)

---

## 🔒 Keamanan

- File `.env` **tidak termasuk dalam repositori** (terlindungi oleh `.gitignore`)
- Kredensial database dan MQTT **tidak disimpan di kode sumber**
- Gunakan **HTTPS** di produksi (sudah diaktifkan di domain utama)

> **Catatan**: Untuk proyek akademik ini, sistem autentikasi (login) akan dikembangkan di tahap selanjutnya.

---

## 📈 Tujuan Akademik

Proyek ini dikembangkan sebagai bagian dari **skripsi** di Program Studi Ilmu Kelautan, Fakultas Perikanan dan Ilmu Kelautan, Universitas Jenderal Soedirman, dengan tujuan:
- Membantu pemantauan distribusi sampah plastik di perairan pesisir
- Menyediakan data real-time untuk analisis lingkungan
- Menguji kelayakan sistem IoT berbasis GPS dan jaringan seluler

---

## 📬 Kontak

- **Penulis**: Jumantoro  
- **NIM**: L1C022006  
- **Email**: jumantoro@mhs.unsoed.ac.id  
- **Institusi**: Universitas Jenderal Soedirman (UNSOED)

---

## 📄 Lisensi

Proyek ini bersifat akademik dan **tidak untuk komersialisasi** tanpa izin tertulis dari penulis.

© 2025 Jumantoro – Program Studi Ilmu Kelautan, UNSOED
```
