#define TINY_GSM_MODEM_SIM800
#include <TinyGsmClient.h>
#include <PubSubClient.h>
#include <TinyGPSPlus.h>
#include <SD.h>
#include <SPI.h>
#include <ArduinoJson.h>

#define MODEM_TX 26
#define MODEM_RX 27
#define GPS_RX 16
#define GPS_TX 17
#define LED_GPRS 2
#define LED_EXTERNAL 15
#define SD_CS 5

TinyGPSPlus gps;
HardwareSerial GPSSerial(2);
HardwareSerial sim800(1);
TinyGsm modem(sim800);
TinyGsmClient client(modem);
PubSubClient mqtt(client);

const char* BROKER = "trackerfpikunsoed.my.id";
const int PORT = 1884;
const char* TOPIC_GPS = "tracker/gps";
const char* TOPIC_CONTROL = "tracker/control/all";
const String DEVICE_ID = "Botol02";

const char APN[] = "internet";
const char GPRS_USER[] = "";
const char GPRS_PASS[] = "";

unsigned long sendInterval = 5000;
unsigned long lastSendTime = 0;
unsigned long gprsLedOnTime = 0;
bool gprsLedActive = false;

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Serial.print("📥 MQTT [");
  Serial.print(topic);
  Serial.print("]: ");
  for (unsigned int i = 0; i < length; i++) Serial.print((char)payload[i]);
  Serial.println();

  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

  if (strcmp(topic, TOPIC_CONTROL) != 0) return;

  StaticJsonDocument<300> doc;
  DeserializationError err = deserializeJson(doc, msg);
  if (err) return;

  if (doc.containsKey("interval")) {
    unsigned long iv = doc["interval"];
    if (iv >= 1000) {
      sendInterval = iv;
      Serial.println("⏱️ Interval: " + String(iv));
    }
  }
  else if (doc.containsKey("command") && doc["command"] == "led") {
    if (doc.containsKey("target") && doc.containsKey("state")) {
      if (String(doc["target"]) == DEVICE_ID) {
        digitalWrite(LED_EXTERNAL, doc["state"] == "on" ? HIGH : LOW);
        Serial.println("💡 LED: " + String(doc["state"]));
      }
    }
  }
}

bool mqttConnect() {
  mqtt.setServer(BROKER, PORT);
  mqtt.setCallback(mqttCallback);
  unsigned long start = millis();
  while (!mqtt.connected() && (millis() - start < 10000)) {
    if (mqtt.connect(DEVICE_ID.c_str())) {
      mqtt.subscribe(TOPIC_CONTROL);
      return true;
    }
    delay(1000);
  }
  return false;
}

bool sendMQTT(String payload) {
  if (!modem.isGprsConnected()) return false;
  if (!mqtt.connected() && !mqttConnect()) return false;
  return mqtt.publish(TOPIC_GPS, payload.c_str());
}

void saveToSD(String payload, bool pending) {
  File f = SD.open("/gps.csv", FILE_APPEND);
  if (f) { f.println(payload); f.close(); }
  if (pending) {
    File p = SD.open("/pending.csv", FILE_APPEND);
    if (p) { p.println(payload); p.close(); }
  }
}

void sendPending() {
  File file = SD.open("/pending.csv", FILE_READ);
  if (!file) return;
  File tmp = SD.open("/temp.csv", FILE_WRITE);
  while (file.available()) {
    String line = file.readStringUntil('\n');
    if (sendMQTT(line)) Serial.println("✅ Resent");
    else if (tmp) tmp.println(line);
  }
  file.close(); tmp.close();
  SD.remove("/pending.csv");
  SD.rename("/temp.csv", "/pending.csv");
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_GPRS, OUTPUT);
  pinMode(LED_EXTERNAL, OUTPUT);
  digitalWrite(LED_GPRS, LOW);
  digitalWrite(LED_EXTERNAL, LOW);

  if (!SD.begin(SD_CS)) Serial.println("❌ SD error");

  GPSSerial.begin(9600, SERIAL_8N1, GPS_RX, GPS_TX);
  sim800.begin(9600, SERIAL_8N1, MODEM_RX, MODEM_TX);
  modem.restart();
  delay(2000);

  if (modem.gprsConnect(APN, GPRS_USER, GPRS_PASS)) {
    digitalWrite(LED_GPRS, HIGH);
    gprsLedOnTime = millis();
    gprsLedActive = true;
    mqttConnect();
  }
}

void loop() {
  if (gprsLedActive && millis() - gprsLedOnTime >= 2000) {
    digitalWrite(LED_GPRS, LOW);
    gprsLedActive = false;
  }

  if (!mqtt.connected()) mqttConnect();
  mqtt.loop();

  while (GPSSerial.available()) gps.encode(GPSSerial.read());

  if (gps.location.isUpdated() && (millis() - lastSendTime >= sendInterval)) {
    lastSendTime = millis();
    float lat = gps.location.lat();
    float lon = gps.location.lng();


    String waktu = "0000-00-00 00:00:00";

    if (gps.date.isValid() && gps.time.isValid()) {
      int h = gps.time.hour() + 7;     // convert UTC → WIB
      int mi = gps.time.minute();
      int s = gps.time.second();
      int d = gps.date.day();
      int m = gps.date.month();
      int y = gps.date.year();

      // Jika jam lebih dari 24, reset + tambah hari
      if (h >= 24) {
        h -= 24;
        d += 1;
      }

      // Format leading zero tampilan jam agar rapi
      char buffer[25];
      sprintf(buffer, "%04d-%02d-%02d %02d:%02d:%02d", y, m, d, h, mi, s);
      waktu = String(buffer);
    }

    String payload = "{\"device_id\":\"" + DEVICE_ID + "\",\"latitude\":" + String(lat, 6) +
                     ",\"longitude\":" + String(lon, 6) + ",\"waktu_gps\":\"" + waktu + "\"}";
    bool sent = sendMQTT(payload);
    saveToSD(payload, !sent);
    if (sent) sendPending();
  }

  delay(10);
}