/*
 * Integração com a API de telemetria AgroIrriga.
 *
 * Endpoints:
 *   http://localhost:3456/api/telemetry          -> última leitura
 *   http://localhost:3456/api/telemetry/history  -> histórico
 */

// Mesma origem quando o front é servido pelo server.js.
// Para front separado, defina antes de carregar este script:
//   window.TELEMETRY_API_URL = "https://seu-backend.exemplo/api/telemetry";
window.TELEMETRY_API_URL =
  window.TELEMETRY_API_URL ||
  "/api/telemetry";


async function lerErroDaResposta(response, mensagemPadrao) {
  let detalhe = "";

  try {
    const erro = await response.json();
    detalhe = erro.detail || erro.error || erro.erro || "";
  } catch (_) {}

  return new Error(
    detalhe || `${mensagemPadrao} (HTTP ${response.status}).`
  );
}


/*
 * Busca a última leitura da estação.
 *
 * Se "limit" for maior que 0, também carrega o histórico
 * e o devolve em "history". Sem "limit", history traz só
 * a última leitura.
 */
async function buscarTelemetria(limit = 0) {
  const response = await fetch(window.TELEMETRY_API_URL, {
    method: "GET",
    headers: { "Accept": "application/json" },
    cache: "no-store"
  });

  if (!response.ok) {
    throw await lerErroDaResposta(
      response,
      "Falha ao consultar a API de telemetria"
    );
  }

  const payload = await response.json();

  if (!payload || typeof payload !== "object") {
    throw new Error("A API retornou dados inválidos.");
  }

  // Compatibilidade com a estrutura antiga de histórico.
  if (Array.isArray(payload.history)) {
    return payload;
  }

  if (
    payload.temperatura_c === undefined &&
    payload.umidade_ar_pct === undefined &&
    payload.solo_pct === undefined
  ) {
    throw new Error(
      "A API respondeu, mas não retornou dados válidos da estação."
    );
  }

  const leitura = {
    pacote: payload.pacote,
    temperature: payload.temperatura_c,
    humidity: payload.umidade_ar_pct,
    pressure: payload.pressao_hpa,

    soil: payload.solo_pct,
    soil15: payload.solo_15cm_pct,
    soil30: payload.solo_30cm_pct,

    rain: payload.chuva,
    chuva: payload.chuva,
    soilRaw: payload.solo_raw,
    rainRaw: payload.chuva_raw,

    horario: payload.data_hora_utc,
    timestamp: payload.data_hora_utc,

    online: payload.online,
    idade_segundos: payload.idade_segundos,
    device_id: payload.device_id,
    fonte: payload.fonte
  };

  let historico = [leitura];

  if (limit > 0) {
    try {
      const lista = await buscarHistorico(limit);
      if (lista.length > 0) historico = lista;
    } catch (err) {
      console.warn(
        "Histórico indisponível, usando apenas a última leitura:",
        err.message
      );
    }
  }

  return {
    ...payload,
    history: historico,
    latest: leitura
  };
}


/*
 * Consulta o histórico armazenado no Firestore.
 *
 * Retorna as leituras em ordem cronológica
 * (da mais antiga para a mais recente).
 */
async function buscarHistorico(limit = 100) {
  // Monta URL absoluta mesmo quando TELEMETRY_API_URL é relativo ("/api/telemetry")
  const base = window.TELEMETRY_API_URL;
  let url;
  if (/^https?:\/\//i.test(base)) {
    url = new URL("/api/telemetry/history", base);
  } else {
    url = new URL(
      "/api/telemetry/history",
      window.location.origin
    );
  }
  url.searchParams.set("limit", limit);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { "Accept": "application/json" },
    cache: "no-store"
  });

  if (!response.ok) {
    throw await lerErroDaResposta(
      response,
      "Falha ao consultar histórico"
    );
  }

  const payload = await response.json();

  if (!payload || !Array.isArray(payload.history)) {
    throw new Error("A API não retornou uma lista de histórico válida.");
  }

  const leituras = payload.history.map(leitura => ({
    ...leitura,

    temperature: leitura.temperatura_c,
    humidity: leitura.umidade_ar_pct,
    pressure: leitura.pressao_hpa,

    soil: leitura.solo_pct,
    soil15: leitura.solo_15cm_pct,
    soil30: leitura.solo_30cm_pct,

    rain: leitura.chuva,

    horario: leitura.data_hora_utc,
    timestamp: leitura.data_hora_utc
  }));

  // Garante a ordem cronológica, independente do servidor.
  return leituras.sort(
    (a, b) => tempoEmMs(a) - tempoEmMs(b)
  );
}


function valorNumerico(valor, padrao = 0) {
  if (valor === null || valor === undefined || valor === "") {
    return padrao;
  }

  const n = Number(valor);

  return Number.isFinite(n) ? n : padrao;
}


function valorBooleano(valor) {
  return (
    valor === true ||
    valor === 1 ||
    valor === "1" ||
    valor === "true"
  );
}


function obterUmidadeSolo(leitura) {
  if (!leitura) return null;

  const solo15 = valorNumerico(
    leitura.soil15 ?? leitura.solo_15cm_pct,
    null
  );
  if (solo15 !== null) return solo15;

  const solo30 = valorNumerico(
    leitura.soil30 ?? leitura.solo_30cm_pct,
    null
  );
  if (solo30 !== null) return solo30;

  return valorNumerico(leitura.soil ?? leitura.solo_pct, null);
}


function obterHorario(leitura) {
  if (!leitura) return null;

  const valor =
    leitura.horario ||
    leitura.timestamp ||
    leitura.data_hora_utc;

  if (!valor) return null;

  const data = new Date(valor);

  return Number.isNaN(data.getTime())
    ? String(valor)
    : data;
}


// Horário da leitura em milissegundos (0 se inválido).
function tempoEmMs(leitura) {
  const data = obterHorario(leitura);
  return data instanceof Date ? data.getTime() : 0;
}


function formatarHorario(leitura, opcoes = {}) {
  const data = obterHorario(leitura);

  if (!data) return "Desconhecido";

  if (!(data instanceof Date)) return data;

  return data.toLocaleString("pt-BR", opcoes);
}