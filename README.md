# Radar Sindical

Microserviço backend em Node.js + TypeScript para monitoramento, extração e alertas de Convenções Coletivas de Trabalho (CCTs). O projeto foi desenhado para operar em duas camadas separadas:

- API Express para consulta e entrega de parâmetros ao portal
- worker em cron para varredura automatizada do MTE e processamento em background

## Visão geral

O Radar Sindical automatiza a busca por convenções coletivas, captura conteúdo oficial, processa as informações com IA e entrega dados estruturados para o Departamento Pessoal e para o portal. O sistema foi pensado para funcionar em ambiente de homologação e produção, com configuração separada por variáveis de ambiente.

## Stack principal

- Node.js + TypeScript
- ts-node-dev para desenvolvimento
- Prisma ORM
- PostgreSQL para desenvolvimento e produção
- Express.js + CORS + dotenv
- node-cron
- axios
- @anthropic-ai/sdk
- playwright

## Estrutura principal

```text
/prisma/schema.prisma
/prisma/seed.ts
/src/server.ts
/src/jobs/dailyUpdate.ts
/src/routes/moduloDpRoutes.ts
/src/services/cctOcr.ts
/src/tools/mteScraper.ts
/src/utils/operationalAlert.ts
/Dockerfile
/docker-compose.yml
/.env.example
```

## Responsabilidades do sistema

### 1. API Express
A API expõe endpoints para consulta de parâmetros da CCT, importação de clientes, dashboard operacional, monitoramento de sindicatos e stream de alertas em tempo real.

Endpoints principais:

- `POST /api/importacao/clientes`: importa CSV de clientes, valida conteúdo textual, calcula SHA-256 e registra lote e linhas inválidas.
- `POST /api/importacao/clientes/xlsx`: recebe uma planilha XLSX binária, valida a assinatura `PK\\x03\\x04`, calcula SHA-256 e usa a primeira aba como origem dos clientes.
- `GET /api/importacao/lotes/:id`: consulta o resultado detalhado de um lote.
- `GET /api/modulo-dp/dashboard/resumo`: retorna o resumo operacional do DP.
- `GET /api/modulo-dp/dashboard/impactos`: lista impactos de folha recentes.
- `GET /api/radar/sindicatos/:id`: consulta o estado e o último scan de um sindicato.
- `GET /api/radar/sindicatos/:id/fallback`: informa o estado da descoberta por site.
- `POST /api/radar/sindicatos/:id/fallback/cct`: captura PDF de CCT/ACT no site oficial e preserva a evidência.
- `GET /api/modulo-dp/alertas/stream`: abre o stream SSE de alertas.
- `GET /health`: liveness público para reinício do processo.
- `GET /readiness`: verifica PostgreSQL e autenticação da API Anthropic antes de aceitar tráfego.

As importações são idempotentes por hash do arquivo: reenviar o mesmo conteúdo retorna o lote original sem criar novas linhas. A persistência do lote, clientes e linhas ocorre em uma transação serializável; falhas durante o processamento fazem rollback da carga.

PDFs capturados pelo MTE recebem hash SHA-256 e têm sua localização registrada em `ConvencaoColetiva` e `EvidenciaCct`. Em desenvolvimento, o arquivo fica temporariamente em `DOCUMENT_STORAGE_PATH`. No worker de produção, `DOCUMENT_STORAGE_DRIVER=workspace` envia o PDF ao Google Drive depois da persistência da CCT e registra no Google Sheets a data, sindicato, resumo e link de compartilhamento.

Configure `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_DRIVE_FOLDER_ID` e `GOOGLE_SHEET_ID` como segredos do GitHub. Compartilhe a pasta do Drive e a planilha com o e-mail da service account, com permissão de edição. O worker publica links de leitura para os PDFs; confirme que essa política atende às regras de acesso da organização antes de ativá-lo.

Após a transcrição, `src/services/claudeAgent.ts` valida um contrato JSON estrito com `impactos_folha` e `contribuicoes_sindicais`. O serviço `src/services/cctExtractionPersistence.ts` grava esses itens em `ImpactoFolha` e `ContribuicaoSindical` dentro de uma transação serializável, preservando evidências textuais e registros já validados pelo DP. O módulo `src/services/cctOcr.ts` permanece responsável exclusivamente pela transcrição de PDFs.

O worker usa locks distribuídos em PostgreSQL por CNPJ (`WORKER_LOCK_TTL_MS`). Falhas do MTE não bloqueiam a fila: cada sindicato registra `proximaTentativa` e `falhasConsecutivas`, com backoff exponencial entre `MTE_RETRY_BASE_DELAY_MS` e `MTE_RETRY_MAX_DELAY_MS`.

Em produção, `PORTAL_AUTH_ENABLED=true` exige `x-api-key` ou `Authorization: Bearer` nas rotas de negócio. Uploads e consultas que usam IA possuem rate limits próprios; o SSE envia heartbeats e remove o listener quando a conexão é encerrada.

### 2. Worker em background
O worker roda em cron às 02:00 e percorre sindicatos ativos para buscar atualizações e processar extrações.

### 3. Scraping do MTE
O scraper usa Playwright para visitar o sistema do Ministério do Trabalho, preencher CNPJ e ano e retornar o texto oficial da CCT para processamento. Se o portal passar a exibir um CAPTCHA, a consulta é interrompida e sinalizada como falha operacional; não há bypass ou dado simulado.

### 4. Extração por IA
O módulo de OCR/extrator usa o Claude para interpretar o texto bruto e devolver JSON estruturado com valores relevantes de convenção.

### 5. Persistência
O Prisma armazena clientes, sindicatos, enquadramentos, CCTs e alertas em PostgreSQL. A aplicação usa migrations versionadas; `db push` não faz parte do fluxo de deploy.

## Modelos do banco

- Cliente
- Sindicato
- Enquadramento
- CCT
- Alerta

A model `CCT` inclui um campo JSON para `parametros` para receber os dados extraídos da convenção.

### Evolução da base para o Hub Sindical

O schema também possui a base da próxima etapa do produto:

- `Cliente.codigoErp` para relacionar a empresa ao Domínio/Alterdata e ao número importado do ERP.
- `Sindicato.siteOficial` e campos de monitoramento para a busca antecipada nos portais sindicais.
- `ImportacaoLote` e `ImportacaoLinha` para rastrear importações de clientes por Excel/CSV.
- `ClausulaCct`, `ImpactoFolha` e `ContribuicaoSindical` para estruturar o painel do DP.
- `EvidenciaCct` para preservar a origem e o hash de cada documento ou informação extraída.
- `ExportacaoSindicato` para controlar futuros arquivos enviados aos sindicatos.

Os dados extraídos continuam sujeitos à validação do DP. Nenhum impacto financeiro ou contribuição deve ser tratado como aprovado apenas por ter sido produzido pela IA.

## Fluxo de execução

1. O worker seleciona sindicatos ativos.
2. O scraper consulta o MTE.
3. O texto bruto é enviado ao Claude.
4. A extração gera JSON estruturado.
5. O resultado é salvo como `CCT` e dispara `Alerta`.
6. A API expõe o conteúdo para o portal via endpoints e SSE.

## Como rodar localmente

```bash
npm install
cp .env.example .env
npx prisma generate
npm run prisma:migrate
npm run dev
```

## Scripts úteis

```bash
npm run dev
npm run build
npm run typecheck
npm run prisma:migrate
npx prisma db seed
```

### Supabase

Para usar o pooler do Supabase, defina `DATABASE_URL` com a URL do pooler em modo transação (porta `6543` e `?pgbouncer=true`) e `DIRECT_URL` com a URL em modo sessão (porta `5432`). O Prisma usa `DATABASE_URL` nas consultas da aplicação e `DIRECT_URL` nas migrations. Configure ambas no `.env` local ou no gerenciador de segredos do ambiente; substitua o placeholder pela senha do banco e faça URL-encode de caracteres reservados. O `.env.example` mantém URLs locais para Docker Compose.

## Docker

O projeto inclui um `Dockerfile` baseado em `mcr.microsoft.com/playwright:v1.63.0-noble` e um `docker-compose.yml` com dois serviços:

- `api`: executa o servidor Express
- `worker`: executa o processamento em cron

## Observações de operação

- o banco usa PostgreSQL e exige `DATABASE_URL` válida
- os valores sensíveis devem ficar em `.env`
- o scraper não usa bypass de CAPTCHA; um desafio visível interrompe a consulta
- o fluxo de extração deve validar JSON rigorosamente para evitar dados inconsistentes

## Status do projeto

O boilerplate do microserviço Radar Sindical foi criado com a base necessária para API, processamento em background, integração com Claude e Playwright, além da organização da estrutura exigida pelo projeto.

## Verificação

Executei a checagem de tipagem do projeto:

```bash
cd /workspaces/BuscaCCT && npm run typecheck -- --pretty false
```

Resultado verificado: o comando concluiu com sucesso, sem erros de TypeScript.

Validação operacional adicional:

- `npm test`: 15 testes aprovados.
- `docker build -t busca-cct:validation .`: imagem construída com sucesso.
- Smoke test do container: `GET /health` respondeu `200`.
- E2E real do Mediador: o portal foi alcançado, mas bloqueou automação com desafio anti-bot. O scraper encerra a consulta sem bypass e sem fabricar dados.


Configure `TI_WEBHOOK_URL` (e não `WEBHOOK_TI_URL`) para receber falhas do worker em Slack, Teams ou outro endpoint compatível
com payload `{ "text": "..." }`. Falhas no webhook são apenas registradas e não interrompem a fila.

### Docker

O [Dockerfile](Dockerfile) inclui Chromium e compila a API para produção:

```bash
docker build -t busca-cct .
docker run --env-file .env -p 3000:3000 busca-cct
```

O worker deve ser executado como processo/container separado usando o mesmo ambiente:

```bash
docker run --env-file .env busca-cct node dist/worker.js
```

Também há um [docker-compose.yml](docker-compose.yml) com API e worker separados e volume
com PostgreSQL persistente. Para subir o conjunto:

```bash
cp .env.example .env
# preencha ANTHROPIC_API_KEY e demais credenciais
docker compose up -d --build
docker compose ps
docker compose logs -f worker
```

Para produção com múltiplas réplicas, use lock distribuído para garantir uma única fila MTE ativa.

## Hardening e Segurança

Antes de expor o módulo para o portal principal, ative autenticação e limitação de taxa por ambiente:

```bash
PORTAL_AUTH_ENABLED=true
PORTAL_API_KEY=chave-super-secreta
CORS_ORIGINS=https://portal.contabilidade.com.br
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
```

Quando `PORTAL_AUTH_ENABLED=true`, o backend exige `x-api-key` ou `Authorization: Bearer ...` em todas as rotas HTTP. Também aplica headers de segurança, CORS e rate limit.

### Componentes relevantes

- `prisma/schema.prisma`: cache persistente das CCTs por CNPJ e ano.
- `src/tools/mteScraper.ts`: extração automatizada do MTE via Playwright.
- `src/services/claudeAgent.ts`: Tool Use, System Prompt estrito e extração JSON validada.
- `src/services/radarDiscovery.ts`: importação da base de sindicatos e varredura de sites.
- `src/services/alertService.ts`: geração e entrega de alertas no portal.
- `src/jobs/dailyUpdate.ts`: cron jobs de varredura e atualização.

O repositório é exclusivamente o microserviço backend. O componente React `CopilotoParametrizacao`
e o hook de SSE devem ser incorporados pelo portal principal; não há frontend React versionado aqui.

O extrator retorna `null` quando a CCT não informa um valor. Os campos monetários e percentuais
são números sem `R$` ou `%`, e o retorno é rejeitado se não respeitar o schema `ExtracaoCct`.
O módulo não audita folhas nem envia dados de funcionários para o Claude.
