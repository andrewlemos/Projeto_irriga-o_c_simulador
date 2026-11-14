const statusMessage = document.getElementById("status-message");
const currentDateEl = document.getElementById("current-date");

const DIAS_HISTORICO = 7;
const LIMITE_BUSCA = 2000;   // registros pedidos à API
const MAX_PONTOS_GRAFICO = 300;

function showStatus(message, isLoading = false) {
  statusMessage.textContent = message;
  statusMessage.className = "status-message" + (isLoading ? " loading" : "");
}

function hideStatus() {
  statusMessage.className = "status-message hidden";
}

// Reduz a quantidade de pontos mantendo o último registro.
function reduzirPontos(lista, maximo) {
  if (lista.length <= maximo) return lista;

  const passo = Math.ceil(lista.length / maximo);
  const reduzida = lista.filter((_, i) => i % passo === 0);

  const ultima = lista[lista.length - 1];
  if (reduzida[reduzida.length - 1] !== ultima) reduzida.push(ultima);

  return reduzida;
}

async function buscarHistoricoSolo() {
  try {
    showStatus("Buscando histórico dos últimos dias...", true);

    // Já vem em ordem cronológica (mais antigo -> mais recente).
    const todas = await buscarHistorico(LIMITE_BUSCA);

    if (todas.length === 0) {
      throw new Error("Nenhum registro encontrado na telemetria.");
    }

    // Mantém só os últimos 7 dias; se não houver, usa tudo.
    const limiteMs = Date.now() - DIAS_HISTORICO * 24 * 60 * 60 * 1000;
    const recentes = todas.filter(l => tempoEmMs(l) >= limiteMs);
    const leituras = recentes.length > 0 ? recentes : todas;

    const validas = leituras.filter(l => obterUmidadeSolo(l) !== null);

    if (validas.length === 0) {
      throw new Error("Os registros recebidos não possuem umidade do solo válida.");
    }

    const amostra = reduzirPontos(validas, MAX_PONTOS_GRAFICO);

    const labels = amostra.map(l =>
      formatarHorario(l, {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
      })
    );
    const dadosUmidade = amostra.map(l =>
      Number(obterUmidadeSolo(l).toFixed(1))
    );

    currentDateEl.textContent =
      `${validas.length} registros carregados com sucesso.`;
    hideStatus();
    renderizarGrafico(labels, dadosUmidade);
  } catch (error) {
    console.error("Erro no histórico:", error);
    showStatus(error.message, false);
  }
}

function renderizarGrafico(labels, dados) {
  const ctx = document.getElementById("soilHistoryChart").getContext("2d");

  new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Umidade do Solo (%)",
        data: dados,
        borderColor: "#38bdf8",
        backgroundColor: "rgba(56, 189, 248, 0.15)",
        borderWidth: 2,
        pointBackgroundColor: "#38bdf8",
        pointRadius: 2,
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: "#f8fafc", font: { family: "'Segoe UI', sans-serif" } }
        }
      },
      scales: {
        x: {
          ticks: { color: "#94a3b8", maxTicksLimit: 8 },
          grid: { color: "rgba(255, 255, 255, 0.05)" }
        },
        y: {
          beginAtZero: true,
          max: 100,
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(255, 255, 255, 0.05)" }
        }
      }
    }
  });
}

buscarHistoricoSolo();