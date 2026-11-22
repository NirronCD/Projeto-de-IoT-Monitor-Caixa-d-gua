# Monitor Inteligente de Caixa d'Água

Um ESP32 com sensor ultrassônico mede o nível da caixa d'água e liga a bomba sozinho abaixo de 20%,
desligando ao chegar em 90%. A regra roda no próprio ESP32 e continua funcionando sem internet.
A cada 2 s a leitura vai por HTTPS para um app web, que mostra nível, bomba, histórico e alertas
e permite controle manual e ajuste dos limites. O circuito roda no simulador [Wokwi](https://wokwi.com).

## Estrutura

```
firmware/caixa_dagua/
  caixa_dagua.ino        firmware do ESP32
  diagram.json           circuito do Wokwi
  libraries.txt          bibliotecas usadas pelo Wokwi (ArduinoJson)
  secrets.example.h      modelo de credenciais do firmware
web/                     app Next.js: API + painel
  app/api/leituras/      POST do ESP32
  app/api/estado/        estado para o painel
  app/api/comando/       comandos do painel
  app/Painel.tsx         interface do painel
  lib/estado.ts          estado em memória e regras de validação
  proxy.ts               login do painel (HTTP Basic Auth)
  .env.example           modelo das variáveis de ambiente
```

## Rodar o app localmente

Requisitos: [Node.js](https://nodejs.org) 20.9 ou mais novo (com npm).

```bash
cd web
cp .env.example .env     # no Windows (PowerShell): copy .env.example .env
```

Edite o `web/.env` e defina os três valores:

| Variável | Para que serve |
| --- | --- |
| `API_TOKEN` | Token que o ESP32 envia no cabeçalho `Authorization: Bearer ...` (gere um com `openssl rand -hex 32`) |
| `PAINEL_USUARIO` | Usuário do login do painel |
| `PAINEL_SENHA` | Senha do login do painel |

Depois instale as dependências e suba o app:

```bash
npm install
npm run dev              # modo desenvolvimento
# ou, em modo produção:
npm run build
npm start
```

Abra <http://localhost:3000> e entre com `PAINEL_USUARIO` e `PAINEL_SENHA`.
Sem nenhuma leitura recebida, o painel mostra "Nenhuma leitura recebida ainda".

### Testar sem o ESP32

Dá para simular uma leitura do ESP32 com `curl` (no Windows, use o Git Bash ou o WSL).
Troque `SEU_TOKEN` pelo `API_TOKEN` do `.env`:

```bash
curl -X POST http://localhost:3000/api/leituras \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"distancia_cm":81.0,"nivel":21,"sensor_ok":true,"bomba":"desligada","modo":"auto","limite_min":20,"limite_max":90,"rssi":-60,"uptime_s":10}'
```

A resposta traz a configuração desejada, por exemplo
`{"ok":true,"config":{"modo":"auto","bomba_manual":"desligada","limite_min":20,"limite_max":90}}`,
e a leitura aparece no painel. Repita com outros valores de `nivel` para ver o gráfico e os eventos.
Mudando o modo ou os limites no painel, a próxima resposta já traz a nova configuração.
Como o servidor considera o dispositivo offline após 15 s sem leitura, o painel volta para "Offline" logo depois.

## Firmware no Wokwi

1. Crie um projeto ESP32 no Wokwi e substitua o `sketch.ino` e o `diagram.json` pelos arquivos de
   `firmware/caixa_dagua/`. Adicione também o `libraries.txt`.
2. Crie um arquivo `secrets.h` no projeto, a partir do `secrets.example.h`:

   ```cpp
   const char* WIFI_SSID  = "Wokwi-GUEST";
   const char* WIFI_PASS  = "";
   const int   WIFI_CANAL = 6;
   const char* API_URL    = "https://SEU-SERVIDOR/api/leituras";
   const char* API_TOKEN  = "o mesmo API_TOKEN do .env";
   ```

3. Rode a simulação. O nível da água é controlado pela distância do HC-SR04 (clique no sensor),
   e a bomba é o LED azul ligado ao relé. O Monitor Serial mostra cada envio (`[rede] 200 em ... ms`).

O ESP32 do Wokwi sai para a internet pelo gateway público do Wokwi, então o `API_URL` precisa ser um
endereço HTTPS público: ele não alcança o `localhost` da sua máquina. Para testar com o app rodando
localmente, exponha a porta 3000 com um túnel, por exemplo `cloudflared tunnel --url http://localhost:3000`,
e use o endereço gerado no `API_URL`.

Mesmo sem servidor, o controle local funciona: a bomba liga e desliga pela regra 20%/90%, o LED RGB
mostra o estado e o buzzer apita abaixo de 10%.

No Arduino IDE, instale a biblioteca **ArduinoJson** (versão 7) pelo Library Manager e use a placa
"ESP32 Dev Module". Numa rede real, use `WIFI_CANAL = 0` para o ESP32 procurar o canal.

## API

| Rota | Quem chama | Proteção | O que faz |
| --- | --- | --- | --- |
| `POST /api/leituras` | ESP32 | Token Bearer | Recebe a leitura e devolve a configuração desejada |
| `GET /api/estado` | Painel | Login do painel | Última leitura, histórico, eventos, configuração e se o dispositivo está online |
| `POST /api/comando` | Painel | Login do painel | Muda modo, bomba manual ou limites |

**Leitura enviada pelo ESP32** (`POST /api/leituras`):

```json
{"distancia_cm":18.1,"nivel":91,"sensor_ok":true,"bomba":"desligada","modo":"auto","limite_min":20,"limite_max":90,"rssi":-72,"uptime_s":155}
```

`distancia_cm` e `nivel` vêm `null` quando `sensor_ok` é `false`.

**Resposta** (sempre `200` quando a leitura é aceita):

```json
{"ok":true,"config":{"modo":"auto","bomba_manual":"desligada","limite_min":20,"limite_max":90}}
```

Token ausente ou errado recebe `401`; corpo inválido recebe `400` com a lista dos campos com problema.

**Regras de validação da configuração** (as mesmas no servidor e no firmware):
`modo` é `auto` ou `manual`; `bomba_manual` é `ligada` ou `desligada`; `limite_min` vai de 5 a 80;
`limite_max` vai de 20 a 95; e `limite_max - limite_min` deve ser pelo menos 10.

O servidor não consegue abrir conexão até o ESP32, então os comandos do painel chegam na resposta do
próximo POST (padrão *device shadow*), em geral de 2 a 5 s depois.

## Credenciais

O `web/.env` e o `firmware/caixa_dagua/secrets.h` estão no `.gitignore` e nunca devem ir para o
repositório. Use os modelos `web/.env.example` e `firmware/caixa_dagua/secrets.example.h`.
Lembre que o `secrets.h` fica visível em projetos do Wokwi compartilhados: troque o token depois de
compartilhar.
