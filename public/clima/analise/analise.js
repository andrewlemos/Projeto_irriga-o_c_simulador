const statusMessage = document.getElementById("status-message");
const currentDateEl = document.getElementById("current-date");

const JANELA_GRAFICO_HORAS = 24;   // período mostrado no gráfico
const JANELA_TREINO_HORAS = 4;     // período usado para a tendência
const MIN_LEITURAS_TREINO = 5;     // mínimo de leituras para treinar
const HORAS_PREVISAO = 6;          // quantas horas prever
const LIMITE_INCLINACAO = 5;       // máximo de variação realista (% por hora)
const LIMITE_BUSCA = 1500;         // registros pedidos à API
const MS_HORA = 60 * 60 * 1000;

// Regressão linear simples (x em horas, y em % de umidade).
// Devolve apenas a inclinação (% por hora).
function calcularInclinacao(x, y) {
  const n = x.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumXX += x[i] * x[i];
  }

  const denominador = n * sumXX - sumX * sumX;
  const inclinacao = denominador === 0 ? 0 : (n * sumXY - sumX * sumY) / denominador;

  return Math.max(-LIMITE_INCLINACAO, Math.min(LIMITE_INCLINACAO, inclinacao));
}

async function carregarEPrever() {
  try {
    statusMessage.textContent = "Carregando telemetria e calculando tendência ML...";
    statusMessage.className = "status-message loading";

    // Ordem cronológica: mais antigo -> mais recente.
    const todas = await buscarHistorico(LIMITE_BUSCA);

    const validas = todas
      .map(leitura => ({
        leitura,
        umidade: obterUmidadeSolo(leitura),
        ms: tempoEmMs(leitura)
      }))
      .filter(item => item.umidade !== null && item.ms > 0);

    if (validas.length < 2) {
      throw new Error("São necessárias pelo menos duas leituras válidas de umidade do solo para calcular a tendência.");
    }

    const ultimo = validas[validas.length - 1];
    const ultimoMs = ultimo.ms;
    const umidadeAtual = ultimo.umidade;

    // Tempo em horas relativo à última leitura (<= 0).
    const paraPonto = item => ({
      x: (item.ms - ultimoMs) / MS_HORA,
      y: Number(item.umidade.toFixed(1))
    });

    // Dados reais exibidos no gráfico (últimas 24h).
    const janelaGrafico = validas.filter(
      item => item.ms >= ultimoMs - JANELA_GRAFICO_HORAS * MS_HORA
    );
    const pontosReais = janelaGrafico.map(paraPonto);

    // Dados usados para treinar (últimas 4h; se poucos, últimas leituras).
    let janelaTreino = validas.filter(
      item => item.ms >= ultimoMs - JANELA_TREINO_HORAS * MS_HORA
    );
    if (janelaTreino.length < MIN_LEITURAS_TREINO) {
      janelaTreino = validas.slice(-20);
    }

    const pontosTreino = janelaTreino.map(paraPonto);
    const inclinacao = calcularInclinacao(
      pontosTreino.map(p => p.x),
      pontosTreino.map(p => p.y)
    );

    // Previsão parte do último valor real e segue a tendência.
    const pontosPrevisao = [{ x: 0, y: Number(umidadeAtual.toFixed(1)) }];
    for (let i = 1; i <= HORAS_PREVISAO; i++) {
      const previsto = Math.max(0, Math.min(100, umidadeAtual + inclinacao * i));
      pontosPrevisao.push({ x: i, y: Number(previsto.toFixed(1)) });
    }

    const umidadeFinal = pontosPrevisao[pontosPrevisao.length - 1].y;
    const menorUmidadePrevista = Math.min(...pontosPrevisao.map(p => p.y));

    // Houve chuva nas últimas 3 horas?
    const chuvaRecente = validas.some(
      item =>
        item.ms >= ultimoMs - 3 * MS_HORA &&
        valorBooleano(item.leitura.chuva ?? item.leitura.rain)
    );

    atualizarRecomendacao(
      umidadeAtual,
      menorUmidadePrevista,
      umidadeFinal,
      chuvaRecente,
      inclinacao
    );
    renderizarGrafico(pontosReais, pontosPrevisao);

    currentDateEl.textContent =
      `Previsão atualizada (${janelaTreino.length} leituras usadas na tendência, ` +
      `${inclinacao >= 0 ? "+" : ""}${inclinacao.toFixed(2)}%/h).`;
    statusMessage.className = "status-message hidden";
  } catch (error) {
    console.error("Erro na análise:", error);
    statusMessage.textContent = error.message;
    statusMessage.className = "status-message";
  }
}

function atualizarRecomendacao(atual, menorPrevista, finalPrevista, chovendo, inclinacao) {
  const box = document.getElementById("recommendation-box");
  const icon = document.getElementById("rec-icon");
  const title = document.getElementById("rec-title");
  const desc = document.getElementById("rec-desc");

  if (menorPrevista < 30 || atual < 30) {
    box.className = "recommendation-card status-red";
    icon.className = "ph ph-warning-octagon";
    title.textContent = "Irrigação Necessária!";
    desc.textContent = `Umidade atual de ${atual.toFixed(1)}% e prevista de ${menorPrevista.toFixed(1)}% nas próximas horas. Solo em estado crítico de seca.`;
  } else if (menorPrevista <= 50 || (inclinacao < -1.5 && !chovendo)) {
    box.className = "recommendation-card status-yellow";
    icon.className = "ph ph-warning";
    title.textContent = "Atenção: Intervenção em breve";
    desc.textContent = `Tendência de queda. Umidade projetada: ${finalPrevista.toFixed(1)}% em ${HORAS_PREVISAO}h. Verifique a previsão do tempo antes de acionar.`;
  } else if (inclinacao > 0.5) {
    box.className = "recommendation-card status-green";
    icon.className = "ph ph-check-circle";
    title.textContent = "Não necessita de irrigação";
    desc.textContent = `Umidade em alta (${atual.toFixed(1)}% agora). Solo em ótimas condições, sem necessidade de irrigar.`;
  } else {
    box.className = "recommendation-card status-green";
    icon.className = "ph ph-check-circle";
    title.textContent = "Não necessita de irrigação";
    desc.textContent = `Solo em ótimas condições! A umidade deve se manter estável em ~${finalPrevista.toFixed(1)}% nas próximas ${HORAS_PREVISAO} horas.`;
  }
}

function formatarEixoHoras(valor) {
  if (valor === 0) return "agora";
  return valor > 0 ? `+${valor}h` : `${valor}h`;
}

function renderizarGrafico(pontosReais, pontosPrevisao) {
  const ctx = document.getElementById("forecastChart").getContext("2d");

  new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Últimas leituras (Real)",
          data: pontosReais,
          borderColor: "#38bdf8",
          backgroundColor: "rgba(56, 189, 248, 0.15)",
          borderWidth: 2,
          pointRadius: 1,
          fill: true,
          tension: 0.2
        },
        {
          label: `Próximas ${HORAS_PREVISAO}h (Previsão IA)`,
          data: pontosPrevisao,
          borderColor: "#f59e0b",
          borderDash: [6, 6],
          backgroundColor: "rgba(245, 158, 11, 0.1)",
          borderWidth: 2,
          pointRadius: 3,
          fill: true,
          tension: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      plugins: {
        legend: {
          labels: { color: "#f8fafc", font: { family: "'Segoe UI', sans-serif" } }
        },
        tooltip: {
          callbacks: {
            title: items => {
              const x = items[0].parsed.x;
              return x === 0 ? "Última leitura" : `${x > 0 ? "+" : ""}${x.toFixed(1)}h`;
            }
          }
        }
      },
      scales: {
        x: {
          type: "linear",
          min: -JANELA_GRAFICO_HORAS,
          max: HORAS_PREVISAO,
          ticks: {
            color: "#94a3b8",
            stepSize: 4,
            callback: formatarEixoHoras
          },
          grid: { color: "rgba(255, 255, 255, 0.05)" }
        },
        y: {
          beginAtZero: true,
          max: 100,
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          title: { display: true, text: "Umidade do Solo (%)", color: "#94a3b8" }
        }
      }
    }
  });
}

carregarEPrever();