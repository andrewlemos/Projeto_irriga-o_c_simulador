
const refreshBtn = document.getElementById("refresh-btn");
const currentDateEl = document.getElementById("current-date");
const temperatureEl = document.getElementById("temperature");
const weatherDescriptionEl = document.getElementById("weather-description");
const weatherIconEl = document.getElementById("weather-icon");
const tempAirEl = document.getElementById("temp-air");
const humidityAirEl = document.getElementById("humidity-air");
const pressureValEl = document.getElementById("pressure-val");
const rainStatusEl = document.getElementById("rain-status");
const rainIconEl = document.getElementById("rain-icon");
const statusMessage = document.getElementById("status-message");


function showStatus(message, isLoading = false) {
  statusMessage.textContent = message;
  statusMessage.className =
    "status-message" + (isLoading ? " loading" : "");
}


function hideStatus() {
  statusMessage.className = "status-message hidden";
}


function avaliarUmidadeSolo(porcentagem) {
  if (porcentagem < 30) {
    return {
      status: "Solo Seco (Irrigar)",
      icon: "ph-drop-slash"
    };
  }

  if (porcentagem <= 70) {
    return {
      status: "Solo Ideal",
      icon: "ph-drop-half"
    };
  }

  return {
    status: "Solo Encharcado",
    icon: "ph-drop"
  };
}


async function buscarDadosEstacao() {
  try {
    showStatus("Lendo dados da estação...", true);

    const payload = await buscarTelemetria();

    // Aceita tanto a API atual quanto o formato antigo.
    const leitura =
      payload.latest ||
      (Array.isArray(payload.history) ? payload.history[0] : null) ||
      payload;

    if (!leitura) {
      throw new Error("Nenhuma leitura encontrada na estação.");
    }

    const solo = obterUmidadeSolo(leitura);

    const dados = {
      horario: formatarHorario(leitura, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }),

      temperatura: valorNumerico(
        leitura.temperature ?? leitura.temperatura_c,
        null
      ),

      umidadeAr: valorNumerico(
        leitura.humidity ?? leitura.umidade_ar_pct,
        null
      ),

      pressao: valorNumerico(
        leitura.pressure ?? leitura.pressao_hpa,
        null
      ),

      umidadeSolo: solo,

      precipitacao: valorBooleano(
        leitura.rain ?? leitura.chuva
      ),

      online: valorBooleano(leitura.online)
    };

    atualizarInterface(dados);

    hideStatus();

  } catch (error) {
    console.error("Erro ao buscar telemetria:", error);
    showStatus(error.message, false);
  }
}


function atualizarInterface(dados) {

  currentDateEl.textContent =
    `Leitura: ${dados.horario}`;

  // Umidade do solo em destaque.
  temperatureEl.textContent =
    dados.umidadeSolo === null
      ? "—"
      : Math.round(dados.umidadeSolo);

  if (dados.umidadeSolo !== null) {

    const avaliacao =
      avaliarUmidadeSolo(dados.umidadeSolo);

    weatherDescriptionEl.textContent =
      avaliacao.status;

    weatherIconEl.className =
      `ph ${avaliacao.icon}`;

  } else {

    weatherDescriptionEl.textContent =
      "Umidade indisponível";

    weatherIconEl.className =
      "ph ph-question";
  }

  // Temperatura do ar.
  tempAirEl.textContent =
    dados.temperatura === null
      ? "—"
      : `${dados.temperatura.toFixed(1)} °C`;

  // Umidade relativa do ar.
  humidityAirEl.textContent =
    dados.umidadeAr === null
      ? "—"
      : `${dados.umidadeAr.toFixed(1)}%`;

  // Pressão atmosférica.
  pressureValEl.textContent =
    dados.pressao === null
      ? "—"
      : `${dados.pressao.toFixed(1)} hPa`;

  // Precipitação.
  if (dados.precipitacao) {

    rainStatusEl.textContent = "Chovendo";
    rainIconEl.className = "ph ph-cloud-rain";

  } else {

    rainStatusEl.textContent = "Sem Chuva";
    rainIconEl.className = "ph ph-sun";
  }
}


// Atualização manual.
refreshBtn.addEventListener(
  "click",
  buscarDadosEstacao
);

// Primeira leitura ao abrir a página.
buscarDadosEstacao();

// Atualização automática a cada 60 segundos.
setInterval(buscarDadosEstacao, 60000);
