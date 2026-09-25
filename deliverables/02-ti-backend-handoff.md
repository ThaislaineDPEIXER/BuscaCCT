# Roteiro técnico final para TI / Backend — Go-Live

## 1. Objetivo

Preparar o ambiente de produção para que o sistema:
- suba de forma estável;
- conecte ao banco PostgreSQL;
- execute a API e o worker em isolamento;
- carregue as variáveis sensíveis por ambiente;
- rode a rotina diária e os jobs de monitoramento;
- esteja pronto para integração com o portal e com dados reais.

## 2. Premissas

### Ambiente mínimo
- Linux com Docker e Docker Compose;
- acesso administrativo ao servidor;
- IP ou domínio interno para expor a API;
- volume persistente para PostgreSQL;
- login de execução e regras de firewall;
- acesso às chaves de IA, busca e CAPTCHA;
- política de backup e monitoramento.

### Recomendação de produção
- PostgreSQL em vez de SQLite;
- API e worker rodando como serviços separados;
- controle de logs e healthcheck;
- arquivo de ambiente separado por contexto.

## 3. Estrutura de implantação

### Componentes
- API principal
- Worker de processamento
- Banco PostgreSQL
- Arquivos `.env` por ambiente
- Healthcheck e logs
- Alertas operacionais por webhook

### Arquitetura esperada
- API expõe consultas e alertas para o portal;
- worker executa atualização diária, varreduras e processamento em fila;
- ambos acessam o mesmo banco;
- integração com serviços externos acontece por TLS e credenciais via ambiente.

## 4. Passo a passo de implantação

### Etapa 1 — Preparar o ambiente base
1. Criar usuário de execução do sistema.
2. Instalar Docker e Docker Compose.
3. Criar diretórios para:
   - configuração;
   - logs;
   - banco persistente;
   - arquivos de ambiente.
4. Definir rede interna e regras de exposição.
5. Validar time zone e acesso de rede.

### Etapa 2 — Configurar o PostgreSQL
1. Criar container PostgreSQL.
2. Definir:
   - nome do banco;
   - usuário;
   - senha;
   - porta;
   - volume persistente.
3. Validar conectividade com `psql` ou cliente equivalente.
4. Confirmar encoding, timezone e schema inicial.
5. Aplicar Prisma.

### Etapa 3 — Configurar variáveis de ambiente
Definir por ambiente:
- `DATABASE_URL`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`
- `ANTHROPIC_VISION_MODEL`
- `GOOGLE_CUSTOM_SEARCH_API_KEY`
- `GOOGLE_CUSTOM_SEARCH_ENGINE_ID`
- `CAPTCHA_API_KEY`
- `TI_WEBHOOK_URL`
- `PORT`
- `NODE_ENV`
- `CORS_ORIGINS`
- `SMTP_*` (se for usar e-mail)

Checklist:
- nunca embutir credenciais no código;
- separar dev, homolog e prod;
- manter `.env` fora do repositório;
- usar secrets do ambiente de execução sempre que possível.

### Etapa 4 — Rodar migrações
1. Executar `npx prisma generate`.
2. Executar `npm run prisma:migrate` para aplicar migrations versionadas.
3. Validar schema e tabelas.
4. Rodar `npm run db:seed`.
5. Validar importação inicial.

### Etapa 5 — Subir a API
1. Compilar a aplicação.
2. Definir porta de escuta.
3. Validar healthcheck da API.
4. Verificar CORS e rate limiting.
5. Validar endpoints críticos e segurança HTTP.

### Etapa 6 — Subir o worker
1. Fazer a execução do worker em processo isolado.
2. Confirmar que a rotina de atualização diária inicia corretamente.
3. Validar fila, reprocessamento e logs.
4. Verificar tratamento de erro e retry.
5. Confirmar que a API não fica bloqueada por processamento pesado.

### Etapa 7 — Ativar monitoramento
1. Configurar logs de API e worker.
2. Ativar webhook de TI.
3. Definir alertas de:
   - falha de banco;
   - falha de scraper;
   - limite de timeout;
   - erro de autenticação de provedor.
4. Confirmar alertas e recuperação operacional.

## 5. Validação de Go-Live

### Funcional
- healthcheck da API funcionando;
- banco respondendo corretamente;
- worker iniciando sem deadlock;
- rotina programada executando em horário esperado;
- scraper do MTE acessando dados com timeout controlado;
- cache e deduplicação funcionando;
- alertas sendo gerados corretamente.

### Operacional
- logs legíveis;
- reinício automático funcionando;
- falhas sendo capturadas sem derrubar todos os serviços;
- webhook de TI funcionando;
- backups do banco programados;
- documentação de recuperação disponível.

## 6. Critérios de aprovação

- ambiente de homologação funcional;
- banco PostgreSQL configurado e estável;
- API e worker em execução separada;
- seed validado;
- fluxo do scraper testado com o serviço externo;
- documentação de operação concluída;
- alertas operacionais validados.

## 7. Checklist final da TI

- [ ] Docker e Docker Compose instalados
- [ ] PostgreSQL provisionado
- [ ] volume persistente configurado
- [ ] rede e portas definidas
- [ ] `.env` preenchido com credenciais reais
- [ ] Prisma gerado e tabela validada
- [ ] seed executado
- [ ] API iniciada sem erro
- [ ] worker iniciado sem erro
- [ ] healthcheck validado
- [ ] logs configurados
- [ ] webhook de TI ativo
- [ ] função de CAPTCHA validada
- [ ] atualização diária validada
- [ ] integração com frontend validada

---

> Recomendação: a sequência correta é backend + banco primeiro, CAPTCHA em paralelo, depois dados reais e por fim portal.
