# Runbook de produção — BuscaCCT

## 1. Objetivo

Este runbook orienta a equipe de TI/Backend na implantação do BuscaCCT em ambiente de produção, com API e worker separados, banco persistente e variáveis de ambiente configuradas corretamente.

## 2. Pré-requisitos

- Docker instalado
- Docker Compose instalado
- acesso ao servidor de produção
- acesso ao repositório do projeto
- credenciais do provedor Anthropic
- credenciais do Google Custom Search (se usar busca de radar)
- credenciais do serviço de CAPTCHA, se aprovado
- PostgreSQL ou persistência adequada para produção

## 3. Preparar o ambiente

### 3.1 Clonar o repositório

```bash
cd /opt
git clone <url-do-repositorio> busca-cct
cd busca-cct
```

### 3.2 Criar o arquivo de ambiente

Copie o template e preencha os valores reais:

```bash
cp .env.example .env
```

### 3.3 Ajustar variáveis mínimas de produção

Exemplo de configuração mínima:

```env
PORT=3000
NODE_ENV=production
DATABASE_URL="file:/app/data/prod.db"
ANTHROPIC_API_KEY=SEU_TOKEN
ANTHROPIC_MODEL=claude-sonnet-4-20250514
ANTHROPIC_VISION_MODEL=claude-3-5-sonnet-20241022
GOOGLE_CUSTOM_SEARCH_API_KEY=SEU_TOKEN
GOOGLE_CUSTOM_SEARCH_ENGINE_ID=SEU_ENGINE
TI_WEBHOOK_URL=https://seu-webhook
CORS_ORIGINS=https://portal.exemplo.com
PORTAL_AUTH_ENABLED=false
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
```

> O Compose usa PostgreSQL com volume persistente para desenvolvimento e homologação. Em produção, prefira PostgreSQL gerenciado e mantenha `DATABASE_URL` em Secret Manager.

## 4. Preparar as migrações

### 4.1 Instalar dependências

```bash
npm install
```

### 4.2 Gerar Prisma e aplicar schema

```bash
npx prisma generate
npm run prisma:migrate
```

### 4.3 Carregar seed inicial

```bash
npm run db:seed
```

## 5. Rodar a API e o worker em produção

### 5.1 Build da aplicação

```bash
npm run build
```

### 5.2 Subir com Docker Compose

```bash
docker compose --env-file .env up -d --build
```

### 5.3 Confirmar serviços

```bash
docker compose ps
```

### 5.4 Validar logs

```bash
docker compose logs -f api

docker compose logs -f worker
```

## 6. Checklist de validação pós-implantação

### 6.1 API

- [ ] `GET /health` responde corretamente
- [ ] CORS está ativo conforme domínio esperado
- [ ] rate limit está funcionando
- [ ] variáveis de ambiente foram carregadas
- [ ] logs estão sendo persistidos

### 6.2 Banco

- [ ] Prisma aplicou schema sem erro
- [ ] `Cliente`, `Sindicato`, `ConvencaoColetiva`, `AlertaDP` existem
- [ ] volume do banco persiste entre reinícios

### 6.3 Worker

- [ ] processo iniciou sem erro
- [ ] cron da atualização diária está ativo
- [ ] fila de processamento não está travada
- [ ] falhas de scraper são registradas corretamente

### 6.4 Serviços externos

- [ ] Anthropic respondeu corretamente
- [ ] MTE respondeu sem bloqueio crítico
- [ ] Google Custom Search está configurado corretamente
- [ ] webhook de TI recebe alertas quando ocorre falha operacional

## 7. Procedimento de rollback

Se houver falha crítica em produção:

```bash
docker compose down
```

Em seguida:
1. revisar logs;
2. corrigir `.env` ou credenciais;
3. remover volume apenas se necessário e se houver consistência confirmada;
4. subir novamente com `docker compose up -d --build`.

## 8. Observações operacionais

- O worker deve operar em processo separado para evitar que falhas do scraper derrubem a API.
- Em produção real, use PostgreSQL gerenciado, migrations versionadas e backup automatizado.
- Para a operação de busca no MTE, o uso de CAPTCHA é um requisito funcional para reduzir bloqueios e fraudes de automação.
- O sistema deve registrar todas as falhas críticas para webhook de TI e logs centralizados.

## 9. Comandos úteis

```bash
# reiniciar serviços

docker compose restart

# rebuild completo
docker compose up -d --build --force-recreate

# remover tudo
docker compose down -v

# verificar banco
docker compose exec api npx prisma studio
```

---

> Este runbook deve ser usado como guia operacional da implantação. Qualquer ajuste de ambiente deve ser documentado antes do Go-Live.
