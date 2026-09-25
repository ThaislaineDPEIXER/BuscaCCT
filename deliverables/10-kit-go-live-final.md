# Kit Final de Go-Live — BuscaCCT

## 1. Resumo executivo

O projeto BuscaCCT foi validado como solução técnica funcional para automação de busca, extração e alerta de Convenções Coletivas de Trabalho. O foco agora é a fase de implantação em produção com arquitetura responsável, segura e governável.

A solução foi desenhada para operar em ambiente real com menos manutenção operacional e mais previsibilidade. A arquitetura correta usa:
- Docker para encapsular a aplicação
- variáveis de ambiente para separar código e configuração
- Google Cloud SQL PostgreSQL para o banco de dados
- Google Cloud Storage para PDFs e arquivos temporários
- Compute Engine para rodar a API e o worker em containers separados
- Terraform para provisionar a infraestrutura do GCP de forma reprodutível

Isso permite que o software seja validado em um ambiente de teste e migrado para a empresa sem alterar o código-fonte.

---

## 2. Objetivo estratégico

O objetivo do sistema é transformar a rotina manual do Departamento Pessoal em um processo proativo e automatizado. O produto deve:
- localizar CCTs em fontes oficiais
- gerar cache e rastrear mudanças
- extrair parâmetros relevantes com IA
- identificar novas convenções e atualizações
- alertar a equipe com uma Action Inbox
- entregar os dados ao portal em uma estrutura pronta para uso

---

## 3. Arquitetura recomendada para produção

### Banco de dados

Use Cloud SQL PostgreSQL no Google Cloud.

Benefícios:
- backup automático
- manutenção gerenciada
- mais robustez e consistência
- ausência de risco do disco local da VM

### Armazenamento de PDFs

Use Cloud Storage.

Benefícios:
- os PDFs não ficam presos ao disco da máquina
- o sistema não corre risco de lotar o ambiente
- a recuperação e o backup ficam mais simples
- a aplicação se torna stateless e mais resiliente

### Execução da aplicação

Use Ubuntu em Compute Engine com Docker Compose.

Estrutura:
- API principal em um container
- worker em outro container
- banco em Cloud SQL
- PDFs em Cloud Storage
- credenciais e variáveis em ambiente controlado

### Segurança

Use uma Service Account com permissões mínimas para:
- acessar o banco
- gravar arquivos no bucket
- autenticar silenciosamente a aplicação no Google Cloud

---

## 4. Regra de ouro da migração

A regra de ouro é simples:

- código permanece igual
- configuração muda por ambiente
- infraestrutura é reproduzida pelo Terraform

Em outras palavras:
- o repositório não muda entre o ambiente pessoal e o da empresa
- o `.env` muda
- a chave JSON da service account muda
- o projeto do Google muda
- a infraestrutura do GCP muda

O software continua igual, mas o ambiente de produção passa a obedecer às regras e ferramentas corporativas.

---

## 5. Por que o Docker + variáveis de ambiente é o caminho certo

O código do sistema não precisa saber se está rodando em:
- um ambiente pessoal
- um ambiente de homologação
- um ambiente de produção da empresa

Ele apenas lê:
- `DATABASE_URL`
- chaves de IA
- credenciais de CAPTCHA
- credenciais de cloud

Isso torna a aplicação portátil, segura e migrável sem retrabalho de desenvolvimento.

---

## 6. Justificativa para a diretoria

O investimento em CAPTCHA é estratégico e pequeno quando comparado ao custo manual.

### Impacto prático
- reduz horas de trabalho do DP
- elimina consulta manual repetitiva
- reduz risco de atraso
- aumenta velocidade de resposta
- evita erro humano em validações críticas

A automação não substitui a decisão humana, mas elimina a parte de busca e acompanhamento manual que hoje consome tempo e energia.

---

## 7. Passo a passo da implantação em GCP

### Etapa 1 — Infraestrutura

Gerar a infraestrutura necessária com Terraform.

Recursos:
- Cloud SQL PostgreSQL
- bucket do Cloud Storage
- Service Account
- permissões mínimas para acesso ao banco e ao bucket

### Etapa 2 — Configuração da aplicação

Preencher o `.env` com os valores do ambiente corporativo.

Exemplo:

```env
PORT=3001
NODE_ENV=production
DATABASE_URL="postgresql://modulo_admin:senha@IP_INTERNO:5432/modulodp?sslmode=require"
ANTHROPIC_API_KEY=token_empresa
ANTHROPIC_MODEL=claude-sonnet-4-20250514
ANTHROPIC_VISION_MODEL=claude-3-5-sonnet-20241022
GOOGLE_APPLICATION_CREDENTIALS=/app/gcp-key.json
GOOGLE_CUSTOM_SEARCH_API_KEY=token_google
GOOGLE_CUSTOM_SEARCH_ENGINE_ID=engine_id
CAPTCHA_API_KEY=token_captcha
TI_WEBHOOK_URL=https://webhook.empresa.com/alerta
CORS_ORIGINS=https://portal.empresa.com
```

### Etapa 3 — Aplicação

Subir a aplicação com Docker Compose.

```bash
docker compose up -d --build
```

### Etapa 4 — Banco

Aplicar a estrutura do Prisma e validar o banco.

```bash
docker compose exec api npx prisma migrate deploy
```

### Etapa 5 — Dados

Restaurar o backup validado do ambiente de homologação.

```bash
psql -U usuario_empresa -h ip_banco_empresa -d modulodp -f backup_homologacao.sql
```

---

## 8. Migração sem retrabalho

O processo de migração deve funcionar assim:

### Ambiente de teste
- validar código
- validar extração
- validar regras do negócio
- validar integração e alertas
- exportar backup do banco

### Ambiente da empresa
- provisionar infraestrutura em GCP
- subir código
- trocar `.env`
- trocar `gcp-key.json`
- restaurar backup
- liberar operação

A mudança é apenas de contexto operacional, não de código.

---

## 9. Checklist crítico para Go-Live

### Infraestrutura
- [ ] Cloud SQL configurado
- [ ] backups automáticos ativados
- [ ] bucket do Google Storage criado
- [ ] Service Account configurada
- [ ] permissões corretas e mínimas
- [ ] VM com Docker em execução

### Aplicação
- [ ] `.env` com dados reais preenchidos
- [ ] `gcp-key.json` no servidor correto
- [ ] API iniciada
- [ ] worker iniciando corretamente
- [ ] healthcheck validado
- [ ] logs funcionando
- [ ] webhook de TI ativo

### Operação
- [ ] extração pelo Claude funcionando
- [ ] OCR validado para PDFs escaneados
- [ ] busca no MTE estável
- [ ] alertas e SSE funcionando
- [ ] dados reais importados com sucesso
- [ ] portal integrado e validado

---

## 10. Conclusão final

O projeto BuscaCCT está pronto para sair do estágio de conceito e entrar na fase de implantação prática. A arquitetura correta foi desenhada para reduzir risco, manter a aplicação portátil, manter a infraestrutura gerenciada e facilitar a migração para a empresa.

A regra-chave é clara:
- código continua o mesmo
- ambiente muda
- infraestrutura é reproduzida pelo Terraform
- operação continua estável

Isso cria o caminho mais profissional, seguro e escalável para o Go-Live.

---

## 11. Entregáveis do kit

- [deliverables/01-diretoria-captcha-email.md](./01-diretoria-captcha-email.md)
- [deliverables/02-ti-backend-handoff.md](./02-ti-backend-handoff.md)
- [deliverables/03-go-live-checklist.md](./03-go-live-checklist.md)
- [deliverables/04-runbook-producao.md](./04-runbook-producao.md)
- [deliverables/05-gcp-go-live-checklist.md](./05-gcp-go-live-checklist.md)
- [deliverables/06-frontend-api-sse.md](./06-frontend-api-sse.md)
- [deliverables/07-erp-importacao-seed.md](./07-erp-importacao-seed.md)
- [deliverables/08-go-live-documento-executivo.md](./08-go-live-documento-executivo.md)
- [deliverables/09-migracao-terraform.md](./09-migracao-terraform.md)

Este kit está pronto para ser usado por diretoria, TI, operação e frontend como base documental da entrega final.
