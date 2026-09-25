# Migração para ambiente empresarial com Terraform

## 1. Objetivo

Este guia descreve a forma correta de reproduzir a infraestrutura do projeto em um ambiente corporativo sem alterar o código-fonte. O objetivo é manter o repositório do software imutável e mover apenas a configuração e a infraestrutura para a conta da empresa.

---

## 2. Regra de ouro

O código do projeto deve ser tratado como "cego" em relação ao ambiente. Ele deve apenas obedecer a:
- `.env`
- chaves de acesso
- credenciais de cloud
- variáveis do processo

O que muda entre seu ambiente de desenvolvimento e o da empresa são as variáveis e a infraestrutura provisionada no GCP.

---

## 3. Arquitetura provisionada

O Terraform cria e conecta os seguintes recursos:
- bucket de armazenamento para PDFs
- instância PostgreSQL no Cloud SQL
- banco `modulodp`
- usuário do banco
- Service Account para o robô
- permissões mínimas para leitura e gravação dos PDFs e acesso ao banco

---

## 4. Arquivos Terraform

Os arquivos ficam em:

```text
infra/terraform/
```

Estrutura:

```text
infra/
  terraform/
    main.tf
    variables.tf
    versions.tf
```

---

## 5. Comandos executados pela TI

### 5.1 Inicializar Terraform

```bash
cd infra/terraform
terraform init
```

### 5.2 Simular a criação da infraestrutura

```bash
terraform plan
```

### 5.3 Aplicar a infraestrutura

```bash
terraform apply
```

Durante o `apply`, a TI deve informar:
- `project_id`
- `db_password`

---

## 6. Migração do ambiente de teste para a empresa

### Passo 1 — Backup do ambiente validado

```bash
pg_dump -U seu_usuario -h seu_ip_banco -d modulodp -f backup_homologacao.sql
```

### Passo 2 — Subir a aplicação na empresa

```bash
docker compose up -d --build
```

### Passo 3 — Criar estrutura no banco novo

```bash
docker compose exec api npx prisma migrate deploy
```

### Passo 4 — Restaurar o backup validado

```bash
psql -U usuario_empresa -h ip_banco_empresa -d modulodp -f backup_homologacao.sql
```

Ao final, a operação do robô segue funcionando com o mesmo comportamento que foi validado no ambiente de teste.

---

## 7. Arquivo `.env` corporativo

O `.env` da empresa deve conter apenas os valores reais da infraestrutura corporativa.

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

---

## 8. Chave JSON da Service Account

A função da service account é permitir que a aplicação escreva os PDFs no bucket da empresa sem depender de credenciais humanas no servidor.

O arquivo JSON deve ser gerado pelo administrador do Google Cloud da empresa e colocado na VM junto ao projeto.

Exemplo de local:

```text
/app/gcp-key.json
```

---

## 9. Vantagens da abordagem

- código não precisa mudar entre ambientes
- infraestrutura reaproveita o mesmo desenho em qualquer conta do GCP
- o processo de migração fica em poucos passos
- o ambiente pode ser reproduzido automaticamente pelo Terraform
- o risco de inconsistência operacional cai drasticamente

---

## 10. Conclusão

A migração para a empresa deixa de ser uma reescrita e passa a ser uma troca de configuração e infraestrutura. O software continua o mesmo, o ambiente muda e o código continua sendo idêntico ao que foi testado e validado.

Isso torna o processo de Go-Live muito mais seguro, previsível e controlável.
