# Checklist de implantação no GCP — Go-Live do BuscaCCT

## 1. Objetivo

Implantar o sistema em ambiente de produção com arquitetura segura e resiliente usando serviços gerenciados do Google Cloud Platform (GCP), reduzindo dependência de disco local, volume manual e manutenção de infraestrutura.

A arquitetura final deve usar:
- Cloud SQL PostgreSQL para o banco
- Cloud Storage para PDFs e arquivos temporários
- Compute Engine + Docker para a aplicação
- Service Account com IAM mínimo para acesso ao Google
- variáveis de ambiente para credenciais e endpoints

---

## 2. Arquitetura final recomendada

### 2.1 Banco de dados — Cloud SQL PostgreSQL

Use uma instância do tipo PostgreSQL no Cloud SQL.

Recomendado:
- backup automático diário
- proteção contra exclusão acidental
- rede interna / VPC
- conexão via Cloud SQL Proxy ou via endpoint privado da rede
- uso de usuário dedicado para a aplicação

Variável de ambiente esperada:

```env
DATABASE_URL="postgresql://usuario:senha@IP_INTERNO:5432/modulodp?sslmode=require"
```

Se a arquitetura usar rede interna, a aplicação deve acessar o banco via VPC privada ou proxy, sem expor a porta 5432 publicamente.

### 2.2 Armazenamento — Cloud Storage

Crie um bucket para PDFs e arquivos de apoio, por exemplo:
- `ccts-contabilidade-pdf`

Estrutura sugerida:
- `2026/`
- `2027/`
- `errors/`
- `tmp/`

Objetivo:
- evitar gravação de PDF em disco local da VM
- garantir persistência e recuperação
- permitir acesso simples ao arquivo pelo portal

### 2.3 Aplicação — Compute Engine + Docker

Use uma VM leve e stateless, por exemplo:
- Ubuntu
- e2-medium ou equivalente
- Docker e Docker Compose instalados
- apenas API e worker rodando em containers

A máquina não deve armazenar dados críticos; ela só deve rodar a aplicação e acessar os serviços gerenciados do Google.

### 2.4 IAM e autenticação

Crie uma Service Account para a aplicação, por exemplo:
- `extrator-cct-bot`

Papéis mínimos recomendados:
- Cloud SQL Client
- Storage Object Admin ou Storage Object Creator

Gerar uma chave JSON da conta de serviço e disponibilizar no servidor da aplicação em um local seguro, por exemplo:
- `/app/gcp-key.json`

Variável de ambiente:

```env
GOOGLE_APPLICATION_CREDENTIALS=/app/gcp-key.json
```

---

## 3. Checklist operacional para a TI

### 3.1 Cloud SQL

- [ ] Entrar no Google Cloud Console
- [ ] Acessar SQL
- [ ] Criar instância PostgreSQL
- [ ] Definir nome da instância e região
- [ ] Habilitar backups automáticos diários
- [ ] Habilitar proteção contra exclusão acidental
- [ ] Criar banco `modulodp`
- [ ] Criar usuário dedicado para a aplicação
- [ ] Ajustar rede privada / VPC / Cloud SQL Proxy
- [ ] Validar conexão do app ao banco

### 3.2 Cloud Storage

- [ ] Acessar Cloud Storage
- [ ] Criar bucket para PDFs
- [ ] Definir classe de armazenamento como Standard
- [ ] Configurar permissions mínimas para o bucket
- [ ] Validar upload de PDF via app
- [ ] Confirmar URL pública ou URL assinada com acesso seguro

### 3.3 Service Account e IAM

- [ ] Criar Service Account `extrator-cct-bot`
- [ ] Dar acesso mínimo ao Cloud SQL
- [ ] Dar acesso mínimo ao Storage
- [ ] Gerar chave JSON
- [ ] Salvar o arquivo em local seguro na VM
- [ ] Configurar `GOOGLE_APPLICATION_CREDENTIALS`
- [ ] Validar autenticação sem interação humana

### 3.4 Compute Engine

- [ ] Criar VM Ubuntu
- [ ] Instalar Docker e Docker Compose
- [ ] Clonar o repositório da aplicação
- [ ] Copiar `.env` com valores reais
- [ ] Definir `DATABASE_URL` para o Cloud SQL
- [ ] Definir `GOOGLE_APPLICATION_CREDENTIALS`
- [ ] Validar build da aplicação
- [ ] Subir API e worker via Docker Compose
- [ ] Validar healthcheck e logs

---

## 4. Arquivo de ambiente recomendado para produção

```env
PORT=3001
NODE_ENV=production
DATABASE_URL="postgresql://usuario:senha@IP_INTERNO:5432/modulodp?sslmode=require"
ANTHROPIC_API_KEY=SEU_TOKEN_ANTHROPIC
ANTHROPIC_MODEL=claude-sonnet-4-20250514
ANTHROPIC_VISION_MODEL=claude-3-5-sonnet-20241022
GOOGLE_APPLICATION_CREDENTIALS=/app/gcp-key.json
GOOGLE_CUSTOM_SEARCH_API_KEY=SEU_TOKEN_GOOGLE
GOOGLE_CUSTOM_SEARCH_ENGINE_ID=SEU_ENGINE
CAPTCHA_API_KEY=SEU_TOKEN_CAPTCHA
MTE_MEDIADOR_URL=https://mediador.trabalho.gov.br/sistemas/mediador/ConsultarInstColetivo
TI_WEBHOOK_URL=https://webhook.exemplo.com/alerta
CORS_ORIGINS=https://portal.exemplo.com
PORTAL_AUTH_ENABLED=false
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
```

---

## 5. Docker Compose de produção sugerido

```yaml
version: '3.8'

services:
  api:
    build: .
    restart: always
    ports:
      - "3001:3001"
    environment:
      PORT: 3001
      NODE_ENV: production
      DATABASE_URL: ${DATABASE_URL}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      ANTHROPIC_MODEL: ${ANTHROPIC_MODEL}
      ANTHROPIC_VISION_MODEL: ${ANTHROPIC_VISION_MODEL}
      GOOGLE_APPLICATION_CREDENTIALS: /app/gcp-key.json
      GOOGLE_CUSTOM_SEARCH_API_KEY: ${GOOGLE_CUSTOM_SEARCH_API_KEY}
      GOOGLE_CUSTOM_SEARCH_ENGINE_ID: ${GOOGLE_CUSTOM_SEARCH_ENGINE_ID}
      TI_WEBHOOK_URL: ${TI_WEBHOOK_URL}
    volumes:
      - ./gcp-key.json:/app/gcp-key.json:ro
    command: sh -c "npx prisma migrate deploy && npm start"

  worker:
    build: .
    restart: always
    environment:
      NODE_ENV: production
      DATABASE_URL: ${DATABASE_URL}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      ANTHROPIC_MODEL: ${ANTHROPIC_MODEL}
      ANTHROPIC_VISION_MODEL: ${ANTHROPIC_VISION_MODEL}
      GOOGLE_APPLICATION_CREDENTIALS: /app/gcp-key.json
      GOOGLE_CUSTOM_SEARCH_API_KEY: ${GOOGLE_CUSTOM_SEARCH_API_KEY}
      GOOGLE_CUSTOM_SEARCH_ENGINE_ID: ${GOOGLE_CUSTOM_SEARCH_ENGINE_ID}
      CAPTCHA_API_KEY: ${CAPTCHA_API_KEY}
      TI_WEBHOOK_URL: ${TI_WEBHOOK_URL}
    volumes:
      - ./gcp-key.json:/app/gcp-key.json:ro
    command: sh -c "npx prisma migrate deploy && node dist/worker.js"
```

---

## 6. Fluxo de operação do PDF no GCP

### Processo recomendado

1. Playwright acessa o MTE
2. o sistema detecta a necessidade de CAPTCHA ou processamento do documento
3. o PDF é baixado em memória ou em blob temporário
4. o sistema faz upload para o bucket do Cloud Storage
5. o banco guarda a referência do arquivo e metadados
6. o documento é lido pelo Claude para extração do JSON
7. a resposta estruturada é salva em `ConvencaoColetiva.parametrosJson`
8. o portal pode abrir a URL do arquivo diretamente em PDF ou em visualização segura

### Importante

Nunca depender do disco local da VM para arquivos de produção. O disco da máquina deve ser efêmero e não ser a origem da verdade para documentos legais e PDFs do MTE.

---

## 7. Validação pós-implantação

### 7.1 Banco

- [ ] a aplicação consegue conectar ao Cloud SQL
- [ ] as tabelas do Prisma existem
- [ ] backup automático está ativo
- [ ] os dados persistem entre reinícios

### 7.2 Storage

- [ ] upload de PDF funcionando
- [ ] URL gerada corretamente
- [ ] arquivo acessível para o portal
- [ ] sem dependência de pasta local

### 7.3 API

- [ ] healthcheck respondendo
- [ ] endpoints principais acessíveis
- [ ] autenticação e CORS válidos
- [ ] worker e API funcionando em paralelo

### 7.4 Claude e MTE

- [ ] extração por texto funciona
- [ ] OCR em PDF escaneado funciona
- [ ] CAPTCHA e timeout controlados
- [ ] logs de falha enviados para o webhook de TI

---

## 8. Critérios de aprovação para Go-Live

- [ ] Cloud SQL PostgreSQL configurado
- [ ] Cloud Storage configurado
- [ ] Service Account criado e funcionando
- [ ] VM em Compute Engine está estável
- [ ] API e worker rodando em containers
- [ ] banco e PDFs fora do disco local
- [ ] credenciais validadas
- [ ] fluxo do MTE testado em produção real
- [ ] webhook de TI ativo
- [ ] operação validada pela equipe do DP

---

## 9. Recomendação final da arquitetura

A solução correta para produção não é manter `docker-compose` com banco e arquivos locais. A arquitetura ideal é:
- banco gerenciado no Cloud SQL
- arquivos no Cloud Storage
- aplicação em VM stateless
- acesso à Google via Service Account
- API e worker separados, mas conectados ao mesmo backend de dados

Esse desenho reduz risco operacional, elimina dependência de disco local e entrega um ambiente de produção muito mais resiliente e fácil de manter.
