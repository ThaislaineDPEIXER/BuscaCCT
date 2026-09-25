# Dossiê Final de Implantação — Radar Sindical

## 1. Estado entregue

Commits principais:

- `620aa8f`: baseline seguro com PostgreSQL e Docker Compose
- `b85437c`: importação transacional, Magic Bytes e SHA-256
- `cf1aa04`: storage físico de PDFs e volume Docker compartilhado
- `8f13dce`: extração estruturada e persistência transacional de impactos
- `64710f6`: lock distribuído e retry exponencial do worker
- `31da436`: autenticação, rate limits, SSE hardening e readiness

Validações concluídas:

- `npm run typecheck`: aprovado
- `npm run build`: aprovado
- Suíte PostgreSQL: 23 testes aprovados
- Docker Playwright: imagem construída e `/health` respondeu `200`
- E2E real do Mediador: portal alcançado e bloqueio anti-bot detectado sem bypass

## 2. Arquitetura de runtime

```text
Cloud Load Balancer / Ingress
        |
        v
API Express -- PostgreSQL / Cloud SQL
        |             |
        |             +-- migrations Prisma
        |
        +-- volume de documentos PDF
        |
Worker separado -- lock WorkerLock por CNPJ
        |
        +-- fila MTE com retry persistente
        +-- radar de sites sindicais
        +-- alertas e digest
```

## 3. Variáveis obrigatórias

```env
PORT=3000
NODE_ENV=production
DATABASE_URL=postgresql://usuario:senha@host:5432/radar_sindical?sslmode=require
POSTGRES_DB=radar_sindical
POSTGRES_USER=radar
POSTGRES_PASSWORD=senha-do-ambiente
ANTHROPIC_API_KEY=token-real
DOCUMENT_STORAGE_PATH=/app/data/documents
DOCUMENT_STORAGE_DRIVER=gcs
GCS_BUCKET_NAME=projeto-cct-pdfs
PORTAL_AUTH_ENABLED=true
PORTAL_API_KEY=chave-forte-do-portal
CORS_ORIGINS=https://portal.empresa.com
```

Variáveis operacionais relevantes:

```env
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
UPLOAD_RATE_LIMIT_WINDOW_MS=3600000
UPLOAD_RATE_LIMIT_MAX=20
AI_RATE_LIMIT_WINDOW_MS=60000
AI_RATE_LIMIT_MAX=30
WORKER_LOCK_TTL_MS=1200000
MTE_RETRY_BASE_DELAY_MS=900000
MTE_RETRY_MAX_DELAY_MS=21600000
MTE_MAX_ATTEMPTS=3
MTE_NAVIGATION_TIMEOUT_MS=60000
DOCUMENT_STORAGE_PATH=/app/data/documents
TI_WEBHOOK_URL=https://webhook.empresa.com/alerta
```

Nunca copiar tokens reais para `.env.example`, Git, imagens Docker ou logs.

## 4. Implantação local/homologação

```bash
cp .env.example .env
# preencher DATABASE_URL e ANTHROPIC_API_KEY reais

docker compose up -d --build
docker compose ps
docker compose logs -f api
docker compose logs -f worker
```

O Compose sobe:

- `db`: PostgreSQL 16 com healthcheck
- `api`: migrations e API Express
- `worker`: migrations e jobs cron
- `busca-cct-documents`: volume compartilhado de PDFs
- `busca-cct-postgres`: volume persistente do PostgreSQL

As migrations são aplicadas com:

```bash
docker compose exec api npx prisma migrate deploy
```

Não usar `prisma db push` em produção.

## 5. Probes e segurança

Liveness público:

```bash
curl -fsS http://localhost:3000/health
```

Readiness público, com verificação ativa de PostgreSQL e Anthropic:

```bash
curl -i http://localhost:3000/readiness
```

Rotas de negócio exigem API key quando `PORTAL_AUTH_ENABLED=true`:

```bash
curl -H "Authorization: Bearer $PORTAL_API_KEY" \
  http://localhost:3000/api/modulo-dp/dashboard/resumo
```

O SSE usa heartbeat, desabilita buffering de proxy e remove listeners/timers no encerramento da conexão.

## 6. Fluxo de importação

CSV:

```bash
curl -X POST \
  -H 'Content-Type: text/csv' \
  --data-binary @clientes.csv \
  -H "Authorization: Bearer $PORTAL_API_KEY" \
  http://localhost:3000/api/importacao/clientes
```

XLSX:

```bash
curl -X POST \
  -H 'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' \
  --data-binary @clientes.xlsx \
  -H "Authorization: Bearer $PORTAL_API_KEY" \
  http://localhost:3000/api/importacao/clientes/xlsx
```

Garantias:

- Magic Bytes para XLSX
- rejeição de conteúdo binário em CSV
- limite de 10 MB
- SHA-256 do arquivo
- idempotência por hash
- transação serializável
- rollback em falha

## 7. Fluxo de CCT e evidência

1. MTE ou site sindical fornece o documento.
2. PDF original é salvo no filesystem local ou no bucket GCS selecionado por `DOCUMENT_STORAGE_DRIVER`.
3. O hash SHA-256 é registrado.
4. `EvidenciaCct` guarda URL, storage path e referência.
5. `cctOcr.ts` transcreve o PDF.
6. `claudeAgent.ts` valida o JSON estruturado.
7. `cctExtractionPersistence.ts` grava impactos e contribuições.
8. Registros já validados pelo DP são preservados.

O storage suporta filesystem local (`DOCUMENT_STORAGE_DRIVER=local`) ou Google Cloud Storage (`DOCUMENT_STORAGE_DRIVER=gcs` e `GCS_BUCKET_NAME`). Em GCP, configure Application Default Credentials na identidade de runtime e conceda acesso ao bucket provisionado pelo Terraform; não distribua chaves JSON da service account. Para o worker no GitHub Actions, defina as variáveis `DOCUMENT_STORAGE_DRIVER`, `GCS_BUCKET_NAME`, `GCP_WORKLOAD_IDENTITY_PROVIDER` e `GCP_SERVICE_ACCOUNT` no repositório e configure o provedor Workload Identity Federation para confiar no repositório/branch correto. O modo local continua disponível para desenvolvimento e Docker Compose.

## 8. Worker

O worker é executado separadamente:

```bash
docker compose exec worker node dist/worker.js
```

Na operação normal, o Compose já inicia `dist/worker.js`.

Características:

- lock PostgreSQL por `mte:<cnpj>`
- TTL de lock configurável
- retomada de locks expirados
- retry persistente por sindicato
- backoff exponencial de 15 minutos até 6 horas
- sucesso zera falhas
- erro de um sindicato não derruba a fila

## 9. Terraform GCP

```bash
cd infra/terraform
terraform init
terraform plan \
  -var="project_id=PROJETO_GCP" \
  -var="db_password=SENHA_FORTE" \
  -var="bucket_name_suffix=cct-pdfs"
terraform apply \
  -var="project_id=PROJETO_GCP" \
  -var="db_password=SENHA_FORTE" \
  -var="bucket_name_suffix=cct-pdfs"
```

Antes do Go-Live, revisar obrigatoriamente:

- `deletion_protection = true` no Cloud SQL
- IAM mínimo para a Service Account
- Secret Manager para tokens e senha
- rede privada/Cloud SQL Auth Proxy
- bucket sem exposição pública
- backend remoto do Terraform com lock

## 10. Rollback

```bash
docker compose logs --tail=200 api worker
docker compose down
git checkout <release-anterior>
docker compose up -d --build
```

Não remover volumes sem confirmar backup:

```bash
docker compose down -v
```

Esse comando apaga o PostgreSQL e o volume local de documentos.

## 11. Critérios de Go-Live

- [ ] PostgreSQL gerenciado provisionado
- [ ] migrations aplicadas
- [ ] backup e restore testados
- [ ] secrets fora do Git
- [ ] `PORTAL_AUTH_ENABLED=true`
- [ ] CORS restrito ao portal
- [ ] `/health` e `/readiness` integrados ao orquestrador
- [ ] API e worker separados
- [ ] lock distribuído validado
- [ ] volumes/document storage com política de backup
- [ ] webhook de TI validado
- [ ] portal React integrado com API key e SSE
- [ ] acesso MTE autorizado ou fallback sindical operacional
- [ ] plano de rollback aprovado

## 12. Limitações conhecidas

- O Mediador real bloqueia automação com anti-bot no ambiente validado.
- O código não executa bypass de CAPTCHA nem fabrica CCT.
- O storage atual é volume local persistente; GCS ainda requer adaptador próprio.
- O readiness Anthropic exige `ANTHROPIC_API_KEY` real em produção.
- `npm audit` ainda possui débito transitivo mapeado em Prisma/ExcelJS e deve ser acompanhado no CI.
