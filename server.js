/**
 * AgroIrriga – API de telemetria + servidor de arquivos estáticos
 *
 * Credenciais Firebase:
 *   1. Variável de ambiente GOOGLE_APPLICATION_CREDENTIALS (caminho do JSON), ou
 *   2. Arquivo em credentials/serviceAccount.json (não versionado), ou
 *   3. FIREBASE_SERVICE_ACCOUNT_PATH apontando para o JSON.
 *
 * Nunca commit o arquivo de chave de serviço.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const PORT = process.env.PORT || 3456;
const COLLECTION = process.env.FIRESTORE_COLLECTION || "telemetry";
const ONLINE_THRESHOLD_SEC = Number(process.env.ONLINE_THRESHOLD_SEC || 300);
const PUBLIC_DIR = path.join(__dirname, "public");

let db = null;
let adminOk = false;
let cacheUltimo = null;
let ultimaFalha = null;

function resolveServiceAccountPath() {
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    path.join(__dirname, "credentials", "serviceAccount.json"),
    path.join(__dirname, "projintegrador-4-firebase-adminsdk-fbsvc-189381df6b.json")
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = path.isAbsolute(candidate)
      ? candidate
      : path.join(__dirname, candidate);
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

function initFirebase() {
  try {
    const saPath = resolveServiceAccountPath();
    if (!saPath) {
      throw new Error(
        "Arquivo de credencial Firebase não encontrado. " +
          "Coloque credentials/serviceAccount.json ou defina GOOGLE_APPLICATION_CREDENTIALS."
      );
    }
    const serviceAccount = require(saPath);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    db = admin.firestore();
    adminOk = true;
    console.log("Firebase Admin OK →", path.basename(saPath));
  } catch (err) {
    console.warn("Admin SDK falhou:", err.message);
    ultimaFalha = err.message;
  }
}

initFirebase();

function numeroValido(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function tsParaMs(valor) {
  if (!valor) return null;
  if (typeof valor.toDate === "function") return valor.toDate().getTime();
  if (typeof valor === "string") {
    const p = Date.parse(valor);
    return Number.isFinite(p) ? p : null;
  }
  if (typeof valor === "number") return valor < 1e12 ? valor * 1000 : valor;
  return null;
}

function docParaDados(doc) {
  const d = doc.data() || {};
  const tsMs =
    tsParaMs(d.timestamp) ??
    tsParaMs(d.data_hora_utc) ??
    tsParaMs(d.createdAtIso) ??
    Date.now();

  const temp = numeroValido(d.temp ?? d.temperatura_c);
  const hum = numeroValido(d.hum ?? d.umidade_ar_pct);
  const pressao = numeroValido(d.pabs ?? d.pressao_hpa);
  const soloRaw = numeroValido(d.soilRaw ?? d.soilRaw1 ?? d.solo_raw);
  const soil15 = numeroValido(
    d.soilSensor1 ?? d.soil ?? d.solo_pct ?? d.solo_15cm_pct
  );
  const soil30 = numeroValido(d.soilSensor2 ?? d.solo_30cm_pct);
  const soloPct = soil15 !== null ? soil15 : soil30;
  const chuva = Boolean(d.rain === true || d.chuva === true || d.rain === 1);

  return {
    packetCounter: numeroValido(d.packetCounter ?? d.pacote),
    timestampMs: tsMs,
    temperatura: temp,
    umidadeAr: hum,
    pressao,
    soloPct,
    soloRaw,
    soil15,
    soil30,
    chuva,
    chuvaRaw: numeroValido(d.chuva_raw) ?? (chuva ? 1 : 0),
    deviceId: d.deviceId || d.device_id || "ESP32_Estacao_Campo",
    _demo: false
  };
}

function formatarResposta(dados, demo = false) {
  if (demo || !dados) {
    dados = {
      packetCounter: 9999,
      timestampMs: Date.now() - 20000,
      temperatura: 26.4,
      umidadeAr: 68.2,
      pressao: 948.5,
      soloPct: 42.0,
      soloRaw: 1200,
      soil15: 42.0,
      soil30: 38.5,
      chuva: false,
      chuvaRaw: 0,
      deviceId: "DEMO",
      _demo: true
    };
  }

  const idade = Math.max(
    0,
    Math.round((Date.now() - dados.timestampMs) / 1000)
  );
  const online = !dados._demo && idade <= ONLINE_THRESHOLD_SEC;

  return {
    pacote: dados.packetCounter ?? null,
    data_hora_utc: new Date(dados.timestampMs).toISOString(),
    online,
    idade_segundos: idade,
    temperatura_c:
      dados.temperatura != null ? Number(dados.temperatura.toFixed(1)) : null,
    umidade_ar_pct:
      dados.umidadeAr != null ? Number(dados.umidadeAr.toFixed(1)) : null,
    pressao_hpa:
      dados.pressao != null ? Number(dados.pressao.toFixed(1)) : null,
    solo_pct: dados.soloPct != null ? Number(dados.soloPct.toFixed(1)) : null,
    solo_raw: dados.soloRaw != null ? Math.round(dados.soloRaw) : null,
    chuva: dados.chuva,
    chuva_raw: dados.chuvaRaw,
    solo_15cm_pct:
      dados.soil15 != null ? Number(dados.soil15.toFixed(1)) : null,
    solo_30cm_pct:
      dados.soil30 != null ? Number(dados.soil30.toFixed(1)) : null,
    device_id: dados.deviceId,
    fonte: dados._demo ? "demo" : "firestore"
  };
}

async function buscarUltima() {
  if (!adminOk || !db) {
    ultimaFalha = "Admin SDK nao inicializado";
    return cacheUltimo;
  }
  try {
    let snap = await db
      .collection(COLLECTION)
      .orderBy("timestamp", "desc")
      .limit(1)
      .get();
    if (snap.empty) {
      snap = await db
        .collection(COLLECTION)
        .orderBy("packetCounter", "desc")
        .limit(1)
        .get();
    }
    if (snap.empty) {
      ultimaFalha = "Colecao vazia";
      return cacheUltimo;
    }
    const dados = docParaDados(snap.docs[0]);
    cacheUltimo = dados;
    ultimaFalha = null;
    return dados;
  } catch (err) {
    ultimaFalha = err.message;
    console.warn("[Firestore]", err.message);
    return cacheUltimo;
  }
}

async function buscarHistorico(limite = 100) {
  if (!adminOk || !db) {
    throw new Error("Firebase Admin SDK nao inicializado.");
  }

  const limit = Math.min(Math.max(Number(limite) || 100, 1), 5000);
  const col = db.collection(COLLECTION);

  const tentativas = [
    () => col.orderBy("timestamp", "desc").limit(limit).get(),
    () => col.orderBy("packetCounter", "desc").limit(limit).get(),
    () => col.limit(limit).get()
  ];

  let snap = null;
  let ultimoErro = null;

  for (const tentar of tentativas) {
    try {
      const resultado = await tentar();
      if (!resultado.empty) {
        snap = resultado;
        break;
      }
    } catch (err) {
      ultimoErro = err;
      console.warn("[Historico] tentativa falhou:", err.message);
    }
  }

  if (!snap) {
    if (ultimoErro) throw ultimoErro;
    return { success: true, total: 0, history: [] };
  }

  const history = snap.docs
    .map((doc) => {
      const dados = docParaDados(doc);
      return { id: doc.id, ...formatarResposta(dados) };
    })
    .sort(
      (a, b) =>
        new Date(a.data_hora_utc).getTime() -
        new Date(b.data_hora_utc).getTime()
    );

  return { success: true, total: history.length, history };
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json"
};

function safePublicPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  let rel = decoded === "/" ? "/index.html" : decoded;
  if (rel.endsWith("/")) rel += "index.html";
  const full = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!full.startsWith(PUBLIC_DIR)) return null;
  return full;
}

function serveStatic(req, res) {
  const filePath = safePublicPath(req.url || "/");
  if (!filePath) {
    sendJson(res, 403, { erro: "Caminho invalido" });
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        sendJson(res, 404, {
          erro: "Arquivo nao encontrado",
          path: req.url
        });
        return;
      }
      sendJson(res, 500, { erro: err.message });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": ext === ".html" || ext === ".js" ? "no-cache" : "public, max-age=3600"
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept"
    });
    return res.end();
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendJson(res, 405, { erro: "Metodo nao permitido" });
  }

  const u = new URL(req.url || "/", "http://localhost");
  const p = u.pathname;

  try {
    if (p === "/api/telemetry" || p === "/api/latest" || p === "/api/telemetry/iot") {
      // Compat: /api/telemetry/iot?limit=N devolve histórico no formato { history }
      if (p === "/api/telemetry/iot" && u.searchParams.has("limit")) {
        const limite = u.searchParams.get("limit") || 100;
        const resultado = await buscarHistorico(limite);
        return sendJson(res, 200, resultado);
      }
      const dados = await buscarUltima();
      if (!dados && !adminOk) {
        return sendJson(res, 503, {
          online: false,
          erro: ultimaFalha || "Firebase nao configurado",
          dica: "Coloque credentials/serviceAccount.json ou defina GOOGLE_APPLICATION_CREDENTIALS"
        });
      }
      return sendJson(res, 200, formatarResposta(dados));
    }

    if (p === "/api/telemetry/history" || p === "/api/telemetry/historico") {
      const limite = u.searchParams.get("limit") || 100;
      const resultado = await buscarHistorico(limite);
      return sendJson(res, 200, resultado);
    }

    if (p === "/api/demo") {
      return sendJson(res, 200, formatarResposta(null, true));
    }

    if (p === "/api/health") {
      return sendJson(res, 200, {
        status: "ok",
        projeto: "agroirriga",
        admin_sdk: adminOk,
        cache: !!cacheUltimo,
        erro: ultimaFalha,
        public: PUBLIC_DIR
      });
    }

    // Arquivos estáticos do front-end
    return serveStatic(req, res);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { online: false, erro: err.message });
  }
});

server.listen(PORT, () => {
  console.log("AgroIrriga rodando em http://localhost:" + PORT);
  console.log("  Front:  http://localhost:" + PORT + "/");
  console.log("  API:    GET /api/telemetry");
  console.log("  Hist.:  GET /api/telemetry/history?limit=100");
  console.log("  Health: GET /api/health");
  if (!adminOk) {
    console.warn(
      "⚠ Firebase não inicializado. Coloque a chave em credentials/serviceAccount.json"
    );
  }
});
