const statusMessage = document.getElementById("status-message");
const currentDateEl = document.getElementById("current-date");
const tableBody = document.getElementById("table-body");

const LIMITE_REGISTROS = 100;

function showStatus(message, isLoading = false) {
  statusMessage.textContent = message;
  statusMessage.className = "status-message" + (isLoading ? " loading" : "");
}

function hideStatus() {
  statusMessage.className = "status-message hidden";
}

function avaliarUmidadeSolo(porcentagem) {
  if (porcentagem < 30) return "Solo Seco (Irrigar)";
  if (porcentagem <= 70) return "Solo Ideal";
  return "Solo Encharcado";
}

// Aceita os nomes da API (temperatura_c), os aliases (temperature)
// e os nomes brutos do Firestore (temp), nesta ordem.
function obterTemperatura(leitura) {
  if (!leitura) return null;
  return valorNumerico(
    leitura.temperatura_c ?? leitura.temperature ?? leitura.temp,
    null
  );
}

function obterUmidadeAr(leitura) {
  if (!leitura) return null;
  return valorNumerico(
    leitura.umidade_ar_pct ?? leitura.humidity ?? leitura.hum,
    null
  );
}

function obterPressao(leitura) {
  if (!leitura) return null;
  return valorNumerico(
    leitura.pressao_hpa ?? leitura.pressure ?? leitura.pabs,
    null
  );
}

// Formata um número com 1 casa decimal e sufixo; "—" se não houver valor.
function formatarValor(valor, sufixo = "") {
  return valor === null || valor === undefined
    ? "—"
    : `${Number(valor).toFixed(1)}${sufixo}`;
}

async function buscarHistoricoCompleto() {
  try {
    showStatus("Buscando dados detalhados da estação...", true);

    // Vem em ordem cronológica (mais antigo -> mais recente).
    const historico = await buscarHistorico(LIMITE_REGISTROS);

    if (historico.length === 0) {
      throw new Error("Nenhum registro encontrado na telemetria.");
    }

    // Mostra os registros mais recentes primeiro.
    const leituras = historico.slice().reverse();

    tableBody.innerHTML = "";

    leituras.forEach(leitura => {
      const horario = formatarHorario(leitura, {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
      });
      const solo = obterUmidadeSolo(leitura);
      const temp = obterTemperatura(leitura);
      const hum = obterUmidadeAr(leitura);
      const pressao = obterPressao(leitura);
      const chuva = valorBooleano(leitura.chuva ?? leitura.rain);

      const valores = [
        horario,
        formatarValor(solo, "%"),
        solo === null ? "Sem dado" : avaliarUmidadeSolo(solo),
        formatarValor(temp, " °C"),
        formatarValor(hum, "%"),
        formatarValor(pressao, " hPa"),
        chuva ? "Chovendo 🌧️" : "Sem Chuva ☀️"
      ];

      const row = document.createElement("tr");

      valores.forEach((valor, indice) => {
        const td = document.createElement("td");
        td.textContent = valor;
        if (indice === 1) td.style.cssText = "font-weight:bold;color:#38bdf8;";
        row.appendChild(td);
      });

      tableBody.appendChild(row);
    });

    currentDateEl.textContent =
      `Exibindo as ${leituras.length} leituras mais recentes da estação.`;
    hideStatus();
  } catch (error) {
    console.error("Erro no histórico detalhado:", error);
    showStatus(error.message, false);
  }
}

buscarHistoricoCompleto();