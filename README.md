# Radar CCT

Backend em Node.js + TypeScript para captura, extração e monitoramento de Convenções Coletivas de Trabalho (CCTs).
O projeto opera em duas frentes complementares:

- API Express para consulta, importação e exposição dos dados ao portal.
- worker assíncrono para sincronização de cadastros, coleta no MTE, fallback em site oficial e extração com IA.

## Estado atual

O workspace já reflete o go-live técnico descrito para o Radar CCT:

- scraping do Mediador com `playwright-extra` + `puppeteer-extra-plugin-stealth` em `src/tools/mteScraper.ts`;
- suporte a `MTE_PROXY_URL` para proxy residencial brasileiro;
- fallback automático para o site oficial do sindicato quando o MTE bloqueia, exige CAPTCHA ou não entrega resultado útil;
- persistência de PDFs, evidências e parâmetros extraídos no PostgreSQL;
- suíte automatizada verde com `npm test`.

## Stack principal

- Node.js 22+
- TypeScript 5.9
- Express 5
- Prisma 6.19
- PostgreSQL
- Playwright + stealth plugin
- Gemini + Anthropic com failover automático entre provedores
- Google Drive + Google Sheets para operação em produção

## Estrutura principal

```text
/prisma/schema.prisma
/prisma/seed.ts
/src/server.ts
/src/jobs/dailyUpdate.ts
/src/jobs/runDailyUpdate.ts
/src/routes/importacaoRoutes.ts
/src/routes/moduloDpRoutes.ts
/src/services/claudeAgent.ts
/src/services/cctOcr.ts
/src/services/operationalAlert.ts
/src/services/readiness.ts
/src/tools/mteScraper.ts
/tests/*.test.ts
/.github/workflows/agent-worker.yml
/.env.example
/docker-compose.yml
```

## Fluxos principais

### API

Endpoints mais relevantes:

- `POST /api/importacao/clientes`: importa CSV de clientes com idempotência por hash.
- `POST /api/importacao/clientes/xlsx`: importa planilha Excel validando a assinatura do arquivo.
- `GET /api/importacao/lotes/:id`: consulta o resultado detalhado de um lote.
- `GET /api/modulo-dp/dashboard/resumo`: entrega resumo operacional do DP.
- `GET /api/modulo-dp/dashboard/impactos`: lista impactos recentes de folha.
- `GET /api/radar/sindicatos/:id`: devolve estado atual do monitoramento do sindicato.
- `GET /api/radar/sindicatos/:id/fallback`: informa o estado do fallback por site.
- `POST /api/radar/sindicatos/:id/fallback/cct`: força captura de CCT via site oficial.
- `GET /api/modulo-dp/alertas/stream`: abre SSE de alertas.
- `GET /health`: liveness.
- `GET /readiness`: readiness com PostgreSQL, provedor principal e estado do failover de IA.

### Worker

O worker executa, em ordem:

- importação da pasta de entrada do Google Drive;
- sincronização da planilha administrativa;
- sincronização da matriz de enquadramento;
- processamento de PDFs manuais pendentes;
- fila MTE com lock distribuído por CNPJ;
- extração estruturada com IA e publicação no workspace.

### MTE e fallback

O scraper do Mediador:

- usa `playwright-extra` com `stealthPlugin()`;
- aceita `MTE_PROXY_URL` para navegação via proxy residencial BR;
- detecta anti-bot, CAPTCHA e respostas sem resultado útil;
- persiste a evidência oficial quando o MTE entrega a CCT;
- aciona `buscarCctNoSite(...)` automaticamente quando o MTE falha por bloqueio operacional.

### IA e resiliência

A extração em `src/services/claudeAgent.ts` e a leitura documental em `src/services/aiDocumentReader.ts`:

- escolhem o provedor primário por `AI_PROVIDER`;
- reaplicam tentativas em erros transitórios (`429`, `500`, `502`, `503`, `504`, timeout etc.);
- tentam `GEMINI_MODEL` e, em `404`/modelo incompatível no Gemini, fazem fallback para `gemini-3.8-flash`;
- fazem failover automático para o provedor secundário quando ele estiver configurado;
- desativam o provider secundário no restante da execução se ele responder indisponibilidade terminal de billing/crédito, evitando chamadas repetidas sem chance de sucesso;
- expõem no `/readiness` se o failover está realmente armado (`aiFallbackConfigured`).

Para produção, mantenha **as duas chaves** (`GEMINI_API_KEY` e `ANTHROPIC_API_KEY`) configuradas. Isso evita que um `503` temporário do Gemini interrompa a extração do worker sem alternativa.
Se o Anthropic estiver configurado, mas sem saldo/crédito, o worker registra a indisponibilidade e para de insistir nesse fallback até o próximo processo.

## Variáveis de ambiente

O arquivo `.env.example` lista as variáveis de API, worker, MTE, rate limiting, alertas e integrações Google.
Para o estado atual de produção, os defaults operacionais ficam assim:

```env
AI_PROVIDER=gemini
GEMINI_MODEL=gemini-3.8-flash
ANTHROPIC_MODEL=claude-3-haiku-20240307
ANTHROPIC_VISION_MODEL=claude-3-haiku-20240307
MTE_MAX_ATTEMPTS=3
MTE_NAVIGATION_TIMEOUT_MS=60000
MTE_BATCH_SIZE=5
MTE_DELAY_MIN_MS=30000
MTE_DELAY_MAX_MS=60000
MTE_REQUEST_DELAY_MS=2000
MTE_RETRY_BASE_DELAY_MS=5000
MTE_RETRY_MAX_DELAY_MS=15000
MTE_STALE_AFTER_HOURS=24
WORKER_LOCK_TTL_MS=300000
```

As principais famílias são:

- banco: `DATABASE_URL`, `DIRECT_URL`;
- IA: `AI_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_VISION_MODEL`;
- storage/workspace: `DOCUMENT_STORAGE_DRIVER`, `DOCUMENT_STORAGE_PATH`, `GOOGLE_*`;
- MTE: `MTE_PROXY_URL`, `MTE_MAX_ATTEMPTS`, `MTE_BATCH_SIZE`, `MTE_DELAY_*`, `MTE_RETRY_*`, `WORKER_LOCK_TTL_MS`;
- API: `PORTAL_AUTH_ENABLED`, `PORTAL_API_KEY`, `CORS_ORIGINS`, `RATE_LIMIT_*`, `UPLOAD_RATE_LIMIT_*`, `AI_RATE_LIMIT_*`;
- alertas operacionais: `TI_WEBHOOK_URL`, `SMTP_*`, `ALERT_EMAIL_*`.

## GitHub Actions e go-live

O workflow `Agent Worker` em `.github/workflows/agent-worker.yml` está alinhado com o ambiente de produção atual.

### GitHub Secrets obrigatórios para o worker

- `DATABASE_URL`
- `DIRECT_URL`
- `GEMINI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_CLIENT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_DRIVE_FOLDER_ID`
- `GOOGLE_SHEET_ID`
- `GOOGLE_DRIVE_INBOX_FOLDER_ID`
- `GOOGLE_CUSTOM_SEARCH_API_KEY`
- `GOOGLE_CUSTOM_SEARCH_ENGINE_ID`
- `MTE_PROXY_URL`

### GitHub Secrets opcionais

- `TI_WEBHOOK_URL` (recebe falhas do MTE e indisponibilidade terminal de provider de IA)

### GitHub Variables recomendadas

Defaults atuais do worker em produção:

- `AI_PROVIDER=gemini`
- `GEMINI_MODEL=gemini-3.8-flash`
- `ANTHROPIC_MODEL=claude-3-haiku-20240307`
- `ANTHROPIC_VISION_MODEL=claude-3-haiku-20240307`
- `MTE_MAX_ATTEMPTS=3`
- `MTE_NAVIGATION_TIMEOUT_MS=60000`
- `MTE_BATCH_SIZE=5`
- `MTE_DELAY_MIN_MS=30000`
- `MTE_DELAY_MAX_MS=60000`
- `MTE_REQUEST_DELAY_MS=2000`
- `MTE_RETRY_BASE_DELAY_MS=5000`
- `MTE_RETRY_MAX_DELAY_MS=15000`
- `MTE_STALE_AFTER_HOURS=24`
- `WORKER_LOCK_TTL_MS=300000`

Notas operacionais:

- Se o fallback Anthropic responder erro terminal de billing/crédito, o worker desativa esse provider no processo atual e passa a reportar a indisponibilidade imediatamente.

- o workflow fixa `DOCUMENT_STORAGE_DRIVER=workspace` para publicar artefatos no Google Workspace;
- o input manual `retry_failed_union_imports` reprocessa planilhas/PDFs com erro e pendências do MTE;
- `PORTAL_AUTH_ENABLED` e `PORTAL_API_KEY` são necessários para a API, mas não para o workflow do worker.

## Desenvolvimento local

### Pré-requisitos

- Node.js 22+
- Docker + Docker Compose

### Subir apenas o PostgreSQL local

```bash
cp .env.example .env
docker compose up -d db
```

### Rodar API e worker localmente

```bash
npm ci
npm run build
npm start
npm run start:worker
```

### Rodar com Docker Compose

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
docker compose logs -f worker
```

## Testes e validação

Com o PostgreSQL local disponível em `127.0.0.1:55432`, a suíte é determinística: `npm test` faz reset do banco, reaplica as migrations e executa os testes.

Validação atual do workspace:

- `npm run typecheck`
- `npm run build`
- `npm test` → `91` testes aprovados

## Segurança e operação

- `PORTAL_AUTH_ENABLED=true` exige `x-api-key` ou `Authorization: Bearer ...` nas rotas protegidas.
- uploads, consultas com IA e demais rotas têm rate limits independentes.
- o scraper não tenta burlar CAPTCHA visual; quando necessário, usa fallback oficial por site ou preserva a pendência operacional.
- o webhook de TI não interrompe a fila se falhar.
- quando o Anthropic entra em indisponibilidade terminal de billing/crédito, o worker envia um único webhook e desativa esse fallback até reiniciar o processo.
- em múltiplas réplicas, o lock distribuído evita duas filas MTE no mesmo CNPJ.

## Observações finais

- O repositório contém apenas o backend.
- O portal/front-end consumidor dos endpoints não é versionado aqui.
- O extrator retorna `null` quando a CCT não informa um valor explicitamente.
- Campos monetários e percentuais são armazenados sem `R$` e sem `%`.
