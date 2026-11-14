const admin = require("firebase-admin");
const path = require("path");

const COLLECTION = process.env.FIRESTORE_COLLECTION || "telemetry";
const DEVICE_ID = process.env.DEVICE_ID || "ESP32_Estacao_Campo";
const INTERVALO_MS = Number(process.env.SIM_INTERVAL_MS || 60 * 1000);

function resolveServiceAccountPath() {
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    path.join(__dirname, "credentials", "serviceAccount.json"),
    path.join(__dirname, "projintegrador-4-firebase-adminsdk-fbsvc-189381df6b.json")
  ].filter(Boolean);
  for (const c of candidates) {
    const resolved = path.isAbsolute(c) ? c : path.join(__dirname, c);
    if (require("fs").existsSync(resolved)) return resolved;
  }
  return null;
}

const serviceAccountPath = resolveServiceAccountPath();
try {
  if (!serviceAccountPath) throw new Error("Credencial nao encontrada");
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  console.log("Simulador: Firebase OK →", path.basename(serviceAccountPath));
} catch (err) {
  console.error("Nao foi possivel carregar a chave de servico.");
  console.error("Coloque credentials/serviceAccount.json ou defina GOOGLE_APPLICATION_CREDENTIALS");
  console.error(err.message);
  process.exit(1);
}

const db = admin.firestore();

let estado = {
  pacote: 1000 + Math.floor(Math.random() * 500),
  temperatura: 24 + Math.random() * 8,
  umidadeAr: 55 + Math.random() * 25,
  pressao: 920 + Math.random() * 40,
  soloRaw: 900 + Math.floor(Math.random() * 800),
  chuva: false,
  minutosChuva: 0
};

const RAW_SECO = 2800, RAW_ENCHARC = 550, UMID_MIN = 3.5, UMID_MAX = 22.0;

function rawParaUmidade(raw) {
  if (raw >= RAW_SECO) return UMID_MIN;
  if (raw <= RAW_ENCHARC) return UMID_MAX;
  const fracao = (RAW_SECO - raw) / (RAW_SECO - RAW_ENCHARC);
  return Number((UMID_MIN + fracao * (UMID_MAX - UMID_MIN)).toFixed(1));
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function ruido(a) { return (Math.random() - 0.5) * 2 * a; }

function evoluirEstado() {
  const agora = new Date();
  const hora = agora.getHours() + agora.getMinutes() / 60;
  const alvoTemp = 22 + 8 * Math.sin(((hora - 6) / 24) * 2 * Math.PI);
  estado.temperatura = clamp(estado.temperatura + (alvoTemp - estado.temperatura) * 0.15 + ruido(0.3), 12, 38);
  const alvoUmid = clamp(95 - estado.temperatura * 1.4, 35, 95);
  estado.umidadeAr = clamp(estado.umidadeAr + (alvoUmid - estado.umidadeAr) * 0.12 + ruido(1.5), 30, 98);
  estado.pressao = clamp(estado.pressao + ruido(0.4), 900, 980);
  if (!estado.chuva && Math.random() < 0.04) {
    estado.chuva = true;
    estado.minutosChuva = 1 + Math.floor(Math.random() * 4);
  }
  if (estado.chuva) {
    estado.minutosChuva -= 1;
    if (estado.minutosChuva <= 0) estado.chuva = false;
    estado.soloRaw = clamp(estado.soloRaw - 40 - Math.random() * 60, RAW_ENCHARC, RAW_SECO);
  } else {
    estado.soloRaw = clamp(estado.soloRaw + 5 + Math.random() * 15, RAW_ENCHARC, RAW_SECO);
  }
  estado.pacote += 1;
}

function montarLeitura() {
  evoluirEstado();
  const soloPct = rawParaUmidade(estado.soloRaw);
  const solo30 = clamp(soloPct + ruido(0.8) - 0.3, UMID_MIN, UMID_MAX);
  const agora = new Date();
  return {
    pacote: estado.pacote,
    data_hora_utc: admin.firestore.Timestamp.fromDate(agora),
    online: true,
    idade_segundos: 0,
    temperatura_c: Number(estado.temperatura.toFixed(1)),
    umidade_ar_pct: Number(estado.umidadeAr.toFixed(1)),
    pressao_hpa: Number(estado.pressao.toFixed(1)),
    solo_pct: soloPct,
    solo_raw: Math.round(estado.soloRaw),
    chuva: estado.chuva,
    chuva_raw: estado.chuva ? 1 : 0,
    solo_15cm_pct: soloPct,
    solo_30cm_pct: Number(solo30.toFixed(1)),
    device_id: DEVICE_ID,
    fonte: "simulador",
    packetCounter: estado.pacote,
    timestamp: admin.firestore.Timestamp.fromDate(agora),
    createdAtIso: agora.toISOString(),
    horaLeitura: agora.toLocaleString("pt-BR"),
    temp: Number(estado.temperatura.toFixed(1)),
    hum: Number(estado.umidadeAr.toFixed(1)),
    pabs: Number(estado.pressao.toFixed(1)),
    soilRaw: Math.round(estado.soloRaw),
    soilRaw1: Math.round(estado.soloRaw),
    soilRaw2: Math.round(clamp(estado.soloRaw + 30 + ruido(20), RAW_ENCHARC, RAW_SECO)),
    soilSensor1: soloPct,
    soilSensor2: Number(solo30.toFixed(1)),
    soil: soloPct,
    rain: estado.chuva,
    deviceId: DEVICE_ID
  };
}

async function ciclo() {
  const leitura = montarLeitura();
  console.log(
    `[${leitura.horaLeitura}] Pacote #${leitura.pacote} | T=${leitura.temperatura_c}C UR=${leitura.umidade_ar_pct}% P=${leitura.pressao_hpa}hPa Solo=${leitura.solo_pct}% Chuva=${leitura.chuva ? "SIM" : "nao"}`
  );
  try {
    const docRef = await db.collection(COLLECTION).add(leitura);
    console.log("  OK gravado (doc: " + docRef.id + ")\n");
  } catch (err) {
    console.error("  ERRO ao gravar: " + err.message + "\n");
  }
}

async function main() {
  console.log("=== Simulador Estacao IoT AgroIrriga ===");
  console.log("Projeto: projintegrador-4 | Colecao: telemetry");
  console.log("Intervalo: 60s\n");
  await ciclo();
  setInterval(ciclo, INTERVALO_MS);
}

main().catch((e) => { console.error(e); process.exit(1); });