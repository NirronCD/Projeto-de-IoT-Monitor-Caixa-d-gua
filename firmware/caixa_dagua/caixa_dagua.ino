#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "secrets.h"

const int PIN_TRIG   = 5;
const int PIN_ECHO   = 18;
const int PIN_RELE   = 23;
const int PIN_LED_R  = 25;
const int PIN_LED_G  = 26;
const int PIN_LED_B  = 27;
const int PIN_BUZZER = 13;

const float DIST_VAZIA = 100.0;
const float DIST_CHEIA = 10.0;

const int NIVEL_CRITICO   = 10;
const int NIVEL_SEGURANCA = 98;

const unsigned long INTERVALO_LEITURA_MS = 500;
const unsigned long INTERVALO_ENVIO_MS   = 2000;
const unsigned long TIMEOUT_WIFI_MS      = 15000;
const int TIMEOUT_HTTP_MS = 5000;

struct Config {
  bool modoAuto;
  bool bombaManual;
  int limiteMin;
  int limiteMax;
};

struct Leitura {
  bool sensorOk;
  float distanciaCm;
  int nivel;
  bool bombaLigada;
};

Config config   = { true, false, 20, 90 };
Leitura leitura = { false, 0, 0, false };
portMUX_TYPE trava = portMUX_INITIALIZER_UNLOCKED;

float lerDistanciaCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  unsigned long duracao = pulseIn(PIN_ECHO, HIGH, 30000UL);
  if (duracao == 0) return -1;
  return duracao * 0.0343f / 2.0f;
}

int calcularNivel(float dist) {
  float nivel = (DIST_VAZIA - dist) / (DIST_VAZIA - DIST_CHEIA) * 100.0f;
  return constrain((int)nivel, 0, 100);
}

bool decidirBomba(const Config& c, bool sensorOk, int nivel, bool bombaAtual) {
  if (!sensorOk) return false;
  if (nivel >= NIVEL_SEGURANCA) return false;

  if (!c.modoAuto) return c.bombaManual;

  if (nivel < c.limiteMin)  return true;
  if (nivel >= c.limiteMax) return false;
  return bombaAtual;
}

void setRGB(bool r, bool g, bool b) {
  digitalWrite(PIN_LED_R, r);
  digitalWrite(PIN_LED_G, g);
  digitalWrite(PIN_LED_B, b);
}

void atualizarLed(const Config& c, bool sensorOk, int nivel) {
  if (!sensorOk)                setRGB(0, 0, 1);
  else if (nivel < c.limiteMin) setRGB(1, 0, 0);
  else if (nivel < c.limiteMax) setRGB(1, 1, 0);
  else                          setRGB(0, 1, 0);
}

void atualizarBuzzer(bool alarme) {
  static bool tocando = false;
  bool deveTocar = alarme && (millis() % 1000) < 200;
  if (deveTocar && !tocando)      { tone(PIN_BUZZER, 1000); tocando = true; }
  else if (!deveTocar && tocando) { noTone(PIN_BUZZER);     tocando = false; }
}

bool limitesValidos(int min, int max) {
  return min >= 5 && min <= 80 && max >= 20 && max <= 95 && max - min >= 10;
}

bool aplicarResposta(const String& corpo) {
  JsonDocument doc;
  if (deserializeJson(doc, corpo)) {
    Serial.println("[rede] resposta não é um JSON válido, ignorada");
    return false;
  }
  JsonObjectConst c = doc["config"].as<JsonObjectConst>();
  if (c.isNull()) return false;

  const char* modo  = c["modo"] | "";
  const char* bomba = c["bomba_manual"] | "";
  int min = c["limite_min"] | -1;
  int max = c["limite_max"] | -1;

  bool modoOk  = !strcmp(modo, "auto") || !strcmp(modo, "manual");
  bool bombaOk = !strcmp(bomba, "ligada") || !strcmp(bomba, "desligada");
  if (!modoOk || !bombaOk || !limitesValidos(min, max)) {
    Serial.println("[rede] configuração recebida inválida, ignorada");
    return false;
  }

  Config nova = { strcmp(modo, "auto") == 0, strcmp(bomba, "ligada") == 0, min, max };
  Config antiga;
  portENTER_CRITICAL(&trava);
  antiga = config;
  config = nova;
  portEXIT_CRITICAL(&trava);

  if (nova.modoAuto != antiga.modoAuto || nova.bombaManual != antiga.bombaManual ||
      nova.limiteMin != antiga.limiteMin || nova.limiteMax != antiga.limiteMax) {
    Serial.printf("[rede] nova configuração: modo %s, bomba manual %s, limites %d%%-%d%%\n",
                  modo, bomba, min, max);
  }
  return true;
}

void conectarWiFi() {
  Serial.printf("[wifi] conectando em %s...\n", WIFI_SSID);
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASS, WIFI_CANAL);

  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < TIMEOUT_WIFI_MS) {
    vTaskDelay(pdMS_TO_TICKS(250));
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] conectado, IP %s\n", WiFi.localIP().toString().c_str());
    vTaskDelay(pdMS_TO_TICKS(1500));
  } else {
    Serial.println("[wifi] falhou; tentando de novo (o controle local continua funcionando)");
  }
}

void enviarLeitura(WiFiClientSecure& cliente, HTTPClient& http) {
  Leitura l;
  Config c;
  portENTER_CRITICAL(&trava);
  l = leitura;
  c = config;
  portEXIT_CRITICAL(&trava);

  JsonDocument doc;
  if (l.sensorOk) {
    doc["distancia_cm"] = serialized(String(l.distanciaCm, 1));
    doc["nivel"] = l.nivel;
  } else {
    doc["distancia_cm"] = nullptr;
    doc["nivel"] = nullptr;
  }
  doc["sensor_ok"]  = l.sensorOk;
  doc["bomba"]      = l.bombaLigada ? "ligada" : "desligada";
  doc["modo"]       = c.modoAuto ? "auto" : "manual";
  doc["limite_min"] = c.limiteMin;
  doc["limite_max"] = c.limiteMax;
  doc["rssi"]       = WiFi.RSSI();
  doc["uptime_s"]   = millis() / 1000;
  String corpo;
  serializeJson(doc, corpo);

  if (!http.begin(cliente, API_URL)) {
    Serial.println("[rede] não foi possível iniciar a requisição (confira API_URL)");
    return;
  }
  http.setConnectTimeout(TIMEOUT_HTTP_MS);
  http.setTimeout(TIMEOUT_HTTP_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + API_TOKEN);

  unsigned long t0 = millis();
  int status = http.POST(corpo);
  unsigned long ms = millis() - t0;

  if (status == 200) {
    aplicarResposta(http.getString());
    Serial.printf("[rede] 200 em %lu ms | nível %s | bomba %s | modo %s\n", ms,
                  l.sensorOk ? (String(l.nivel) + "%").c_str() : "--",
                  l.bombaLigada ? "ligada" : "desligada",
                  c.modoAuto ? "auto" : "manual");
  } else if (status > 0) {
    Serial.printf("[rede] servidor respondeu %d: %s\n", status, http.getString().c_str());
  } else {
    Serial.printf("[rede] falha: %s (o controle local continua funcionando)\n",
                  http.errorToString(status).c_str());
    cliente.stop();
  }
  http.end();
}

void tarefaRede(void*) {
  WiFiClientSecure cliente;
  cliente.setInsecure();
  HTTPClient http;
  http.setReuse(true);

  for (;;) {
    if (WiFi.status() != WL_CONNECTED) conectarWiFi();
    else enviarLeitura(cliente, http);
    vTaskDelay(pdMS_TO_TICKS(INTERVALO_ENVIO_MS));
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_RELE, OUTPUT);
  pinMode(PIN_LED_R, OUTPUT);
  pinMode(PIN_LED_G, OUTPUT);
  pinMode(PIN_LED_B, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_RELE, LOW);

  Serial.println("Monitor de Caixa d'Água iniciado");
  WiFi.mode(WIFI_STA);

  xTaskCreatePinnedToCore(tarefaRede, "rede", 16384, NULL, tskIDLE_PRIORITY, NULL, 0);
}

void loop() {
  static unsigned long ultimaLeitura = 0;
  static bool bombaLigada = false;
  static bool alarme = false;

  if (millis() - ultimaLeitura >= INTERVALO_LEITURA_MS) {
    ultimaLeitura = millis();

    Config c;
    portENTER_CRITICAL(&trava);
    c = config;
    portEXIT_CRITICAL(&trava);

    float dist = lerDistanciaCm();
    bool sensorOk = dist > 0;
    int nivel = sensorOk ? calcularNivel(dist) : 0;

    bool novaBomba = decidirBomba(c, sensorOk, nivel, bombaLigada);
    if (novaBomba != bombaLigada) {
      Serial.printf("[controle] bomba %s (nível %d%%, modo %s)\n",
                    novaBomba ? "LIGADA" : "desligada", nivel, c.modoAuto ? "auto" : "manual");
    }
    bombaLigada = novaBomba;
    alarme = sensorOk && nivel < NIVEL_CRITICO;

    digitalWrite(PIN_RELE, bombaLigada ? HIGH : LOW);
    atualizarLed(c, sensorOk, nivel);

    portENTER_CRITICAL(&trava);
    leitura = { sensorOk, dist, nivel, bombaLigada };
    portEXIT_CRITICAL(&trava);
  }

  atualizarBuzzer(alarme);

  delay(10);
}
