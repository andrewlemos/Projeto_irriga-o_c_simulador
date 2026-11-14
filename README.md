# AgroIrriga

Projeto unificado: **API de telemetria** (Node.js + Firebase Admin) + **dashboard web** (estação local, histórico, análise de tendência e clima genérico).

As páginas do front **não** embutem chaves Firebase. Toda a autenticação administrativa fica apenas no backend.

## Estrutura

```text
agroirriga/
├── server.js                 # API + servidor de arquivos estáticos
├── simulador-estacao.js      # Gera leituras de teste no Firestore
├── package.json
├── .env.example
├── .gitignore                # ignora node_modules e credenciais
├── credentials/              # coloque serviceAccount.json aqui (não versionado)
│   ├── .gitkeep
│   └── README.md
└── public/                   # front-end servido em /
    ├── index.html            # redireciona para a estação
    ├── clima/
    │   ├── telemetry-api.js  # cliente HTTP da API
    │   ├── local/            # dashboard da estação IoT
    │   ├── historico/
    │   ├── analise/          # tendência (regressão linear)
    │   └── geral/            # clima Open-Meteo (complementar)
```

## Pré-requisitos

- Node.js 18+
- Projeto Firebase com Firestore e uma **conta de serviço** (Service Account)

## Configuração das credenciais (sem expor senhas no Git)

1. Gere uma chave de serviço no Firebase Console (Project settings → Service accounts).
2. Salve como:

```bash
credentials/serviceAccount.json
```

Ou exporte:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/caminho/absoluto/serviceAccount.json"
```

O `.gitignore` já bloqueia `credentials/*`, `*.json` de service account e `.env`.

## Instalação e execução

```bash
npm install
npm start
```

Abra:

- Front: http://localhost:3456/
- Última leitura: http://localhost:3456/api/telemetry
- Histórico: http://localhost:3456/api/telemetry/history?limit=50
- Health: http://localhost:3456/api/health

### Simulador (opcional)

Com a mesma credencial configurada:

```bash
npm run simulador
```

Envia pacotes periódicos para a coleção `telemetry`.

## Endpoints da API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/telemetry` | Última leitura normalizada |
| GET | `/api/latest` | Alias de `/api/telemetry` |
| GET | `/api/telemetry/iot` | Compatibilidade (com `?limit=` devolve histórico) |
| GET | `/api/telemetry/history?limit=N` | Histórico (máx. 5000) |
| GET | `/api/telemetry/historico?limit=N` | Alias do histórico |
| GET | `/api/demo` | Resposta de demonstração (sem Firestore) |
| GET | `/api/health` | Status do processo e do Admin SDK |

Campos principais da resposta: `temperatura_c`, `umidade_ar_pct`, `pressao_hpa`, `solo_pct`, `solo_15cm_pct`, `solo_30cm_pct`, `chuva`, `online`, `data_hora_utc`, `device_id`, `fonte`.

## Front em domínio separado

No HTML, **antes** de carregar `telemetry-api.js`:

```html
<script>
  window.TELEMETRY_API_URL = "https://seu-backend.exemplo/api/telemetry";
</script>
<script src="clima/telemetry-api.js"></script>
```

O backend já envia `Access-Control-Allow-Origin: *`.

## Segurança

- Nunca commite `credentials/serviceAccount.json` nem arquivos `*firebase-adminsdk*.json`.
- Se alguma chave já foi compartilhada no passado, **revogue** no console Google/Firebase e gere outra.
- O front usa apenas HTTP público da API; não há SDK Firebase no navegador para dados da estação.

## Integração dos repositórios anteriores

- Backend original (`agroirriga-api`): lógica Firestore, normalização de sensores e simulador.
- Front integrado (`PI-04-...-Grupo3`): páginas de estação, histórico e análise consumindo a API via `telemetry-api.js`.

Este repositório unifica os dois, serve o front pelo mesmo processo Node e remove credenciais do código versionado.
