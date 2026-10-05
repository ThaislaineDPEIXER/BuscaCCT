# Plano de Expansão do Radar CCT

## Objetivo

O Radar CCT já atingiu maturidade técnica no núcleo operacional: scraping resiliente, fallback autônomo, extração com IA e suíte de testes estável. O próximo ciclo deve transformar essa base em dois produtos comercializáveis, preservando o mesmo core de captura e processamento:

1. **Licença corporativa On-Premise / Private Cloud** para clientes que precisam operar com infraestrutura própria e BYOK.
2. **Plataforma SaaS multi-tenant** para assinatura recorrente, autosserviço e escala comercial.

O princípio arquitetural é simples: manter **worker, scraper, pipeline documental e regras de extração** como núcleo compartilhado, e evoluir apenas as camadas de empacotamento, tenancy, autenticação, billing e experiência de uso.

## Base técnica já pronta para alavancagem

O projeto atual já oferece os ativos mais caros e difíceis de replicar:

- integração resiliente com o MTE via `playwright-extra` + `stealth plugin` + proxy residencial;
- fallback automatizado para sites oficiais dos sindicatos;
- failover entre provedores de IA para reduzir indisponibilidade operacional;
- persistência estruturada de PDFs, evidências e metadados;
- API e worker desacoplados, o que facilita empacotamento e escala separada;
- suíte com `91` testes, reduzindo risco de regressão em expansão de produto.

Essa base permite que a evolução comercial aconteça sem reescrever o core do domínio.

## Estratégia de produto

### Trilha 1 — Software Base On-Premise

#### Proposta de valor

Entregar o Radar CCT para rodar no ambiente do cliente, com dados, credenciais, integrações e custos de IA sob controle da própria empresa. Esse modelo atende clientes com exigências de compliance, soberania de dados, política de segurança interna ou contratos enterprise.

#### Requisitos de engenharia

1. **Dockerização completa**
   - padronizar execução de `api`, `worker`, `db-migrate` e, opcionalmente, `postgres` local para POC;
   - fornecer `Dockerfile` multi-stage para build reprodutível;
   - consolidar `docker-compose.yml` para ambiente de demonstração e implantação inicial;
   - preparar `healthcheck`, readiness e variáveis obrigatórias por serviço.

2. **Empacotamento operacional**
   - script de bootstrap (`make setup`, `./scripts/setup.sh` ou equivalente) para gerar `.env`, validar credenciais e subir stack;
   - script de verificação (`doctor`) para testar banco, Google Drive/Sheets, IA e proxy MTE;
   - script de migração e seed controlado para primeira instalação e upgrades.

3. **BYOK e BYOR (Bring Your Own Resources)**
   - permitir configuração do cliente para `GEMINI_API_KEY` e/ou `ANTHROPIC_API_KEY` próprios;
   - suportar Google Drive e Google Sheets do próprio cliente por credenciais locais;
   - documentar isolamento de chaves por ambiente (`dev`, `staging`, `prod`);
   - manter segredos fora do repositório, com suporte a `.env`, Docker secrets ou secret manager corporativo.

4. **Gestão local de credenciais e segurança**
   - remover dependência de qualquer segredo hardcoded;
   - fornecer template de permissões mínimas para contas de serviço Google;
   - suportar rotação de chaves sem rebuild da aplicação;
   - registrar auditoria mínima de eventos críticos: login técnico, execução do worker, falhas de integração e mudanças operacionais.

5. **Observabilidade para cliente corporativo**
   - logs estruturados em JSON;
   - métricas mínimas por coleta, tempo de extração, falhas por sindicato e status do fallback;
   - integração opcional com Prometheus/Grafana ou export para SIEM corporativo.

6. **Upgrade path e versionamento**
   - definir versão semântica do produto;
   - incluir changelog de schema e playbook de upgrade;
   - empacotar migrations Prisma com procedimento idempotente.

#### Arquitetura recomendada

- `api` e `worker` em containers separados;
- banco PostgreSQL gerenciado pelo cliente ou serviço homologado por ele;
- storage opcional local/S3 compatível, além da integração com Google Drive já existente;
- execução agendada do worker por cron containerizado, scheduler da nuvem do cliente ou GitHub Actions self-hosted.

#### Entregáveis do produto On-Premise

- kit de instalação (`Dockerfile`, `docker-compose`, scripts de setup, migrations);
- manual de credenciais BYOK/BYOR;
- checklist de hardening;
- guia de operação diária e troubleshooting;
- licença comercial + pacote de suporte/SLA.

#### Próximos passos de engenharia

1. Fechar empacotamento Docker de produção.
2. Criar script de setup/doctor.
3. Padronizar secrets e documentação de integração Google/IA/proxy.
4. Adicionar logs estruturados e métricas.
5. Testar instalação limpa em ambiente externo ao time.

### Trilha 2 — Plataforma SaaS CCT

#### Proposta de valor

Transformar o Radar CCT em uma plataforma web de assinatura para múltiplos clientes B2B. O usuário entra no portal, pesquisa CCTs, baixa PDFs originais, lê resumos gerados por IA, acompanha vigência de sindicatos e recebe alertas sobre novidades.

#### Capacidades do produto SaaS

- login e gestão de usuários por empresa;
- busca por sindicato, CNPJ, vigência, categoria e UF;
- download dos documentos originais e visualização de evidências;
- resumos executivos gerados por IA e campos estruturados;
- alertas por e-mail/webhook para novas convenções ou vencimentos próximos;
- painel com histórico, status de monitoramento e cobertura por sindicato;
- API para clientes enterprise consumirem o acervo via token.

#### Evolução arquitetural necessária

1. **Modelo multi-tenant no banco**
   - introduzir entidades como `tenants`, `tenant_users`, `tenant_api_keys`, `tenant_unions`, `alerts`, `subscriptions` e `usage_events`;
   - associar cada registro funcional ao `tenant_id` quando o dado for privado do cliente;
   - separar claramente dados globais do acervo (ex.: documentos canônicos, sindicatos, metadados públicos) de dados privados por cliente (favoritos, alertas, acessos, relatórios, consumo);
   - preparar chaves compostas e índices por `tenant_id` para manter performance.

2. **Supabase multi-tenant com RLS**
   - usar Supabase Auth para autenticação de usuários do portal;
   - aplicar RLS em tabelas multi-tenant, com políticas baseadas em `tenant_id` presente no JWT;
   - criar papéis distintos: usuário final, admin do tenant e serviço interno;
   - reservar `service_role` apenas para jobs de backend confiáveis;
   - versionar políticas e testes de segurança para impedir vazamento lateral entre clientes.

3. **API restrita por tokens de cliente**
   - expor uma camada de API para consumo externo com `tenant_api_keys` ou JWT machine-to-machine;
   - aplicar escopos (`read:ccts`, `read:documents`, `read:alerts`, `manage:webhooks`);
   - registrar uso por token para billing, rate limiting e auditoria;
   - suportar rotação e revogação sem downtime.

4. **Frontend web em Next.js/React**
   - portal com dashboard, busca, filtros, detalhe da CCT e centro de alertas;
   - autenticação integrada ao Supabase;
   - download seguro de PDFs com autorização contextual;
   - telas de administração do tenant para usuários, tokens e preferências.

5. **Billing e comercialização**
   - integrar Stripe para checkout, assinaturas, renovação, trial e cobrança por plano;
   - refletir o estado da assinatura no backend (`active`, `past_due`, `canceled`, `trialing`);
   - bloquear features premium por feature flags atreladas ao plano;
   - registrar eventos de cobrança para suporte e reconciliação financeira.

6. **Pipeline operacional SaaS**
   - manter o worker centralizado coletando e atualizando o acervo mestre;
   - desacoplar captura global de personalizações por tenant;
   - criar fila de alertas e notificações derivada das mudanças do acervo;
   - materializar visões de leitura para acelerar portal e API pública autenticada.

#### Arquitetura alvo do SaaS

- **Core de ingestão**: worker atual continua responsável por coleta, fallback, OCR/IA e atualização do acervo central.
- **Core transacional**: Supabase/Postgres com particionamento lógico entre dados globais e dados por tenant.
- **Camada de aplicação**: API Node.js evoluída para tenancy, autorização e billing hooks.
- **Camada de experiência**: frontend Next.js/React consumindo API autenticada.
- **Camada de monetização**: Stripe + webhooks + controle de plano/limites.
- **Camada de observabilidade**: logs, métricas, tracing e painéis por tenant.

#### Roadmap técnico sugerido

##### Fase 1 — Productização do core

- consolidar contratos estáveis de API;
- normalizar eventos operacionais do worker;
- melhorar observabilidade e tratamento de erros recuperáveis;
- separar configurações específicas de ambiente e cliente.

##### Fase 2 — Fundamentos de tenancy

- modelar `tenant_id` e entidades de acesso;
- aplicar RLS e testes de isolamento;
- criar autenticação de usuários e tokens de API;
- introduzir trilha de auditoria e rate limiting por tenant.

##### Fase 3 — Portal web

- desenvolver frontend Next.js com autenticação, dashboard e busca;
- liberar área de documentos, resumo IA e alertas;
- validar UX com clientes-piloto.

##### Fase 4 — Billing e go-to-market

- integrar Stripe;
- criar planos e limites de uso;
- implementar trial, cobrança recorrente e cancelamento;
- ativar onboarding comercial e métricas de conversão.

## Estratégia de compartilhamento entre os dois modelos

Para evitar duplicação de engenharia, a recomendação é manter um **monorepo de produto** com módulos compartilhados:

- `core-ingestion`: scraper, fallback, OCR/IA, heurísticas, parser e evidências;
- `core-domain`: entidades, regras de negócio, classificação e vigência;
- `core-api`: endpoints reutilizáveis em On-Premise e SaaS;
- `deploy-onprem`: assets de empacotamento e instalação;
- `saas-portal`: frontend, tenancy, billing e administração.

O diferencial competitivo está no **core de captura e interpretação das CCTs**, não na duplicação de interfaces.

## Riscos e mitigação

### Dependência de fontes externas

- risco: mudanças no MTE, Cloudflare ou sites sindicais;
- mitigação: manter fallback multi-fonte, observabilidade por fonte e suíte de regressão do scraper.

### Custo e disponibilidade de IA

- risco: indisponibilidade temporária ou aumento de custo por provedor;
- mitigação: failover Gemini/Claude, BYOK no On-Premise e feature flags para níveis de extração no SaaS.

### Vazamento entre tenants no SaaS

- risco: falha de modelagem ou política RLS;
- mitigação: isolamento por `tenant_id`, testes automatizados de RLS, revisão de políticas e uso restrito de credenciais privilegiadas.

### Complexidade operacional

- risco: aumento de suporte após comercialização;
- mitigação: instalação padronizada, documentação forte, healthchecks, métricas e automação de diagnóstico.

## Recomendação executiva

O caminho mais eficiente é executar em paralelo com prioridade técnica assimétrica:

1. **Primeiro** productizar o core para On-Premise, porque isso exige menos mudança estrutural e gera receita enterprise mais cedo.
2. **Em seguida** construir a base multi-tenant do SaaS, reaproveitando o mesmo worker e o mesmo acervo.
3. **Só depois** acelerar portal, billing e autosserviço comercial, quando tenancy e segurança estiverem sólidos.

Essa sequência reduz risco, monetiza a base atual mais rápido e preserva o investimento já feito no backend de captura e processamento.

## Resultado esperado

Ao final dessa expansão, o Radar CCT deixa de ser apenas um backend operacional robusto e passa a existir como uma **linha de produto dupla**:

- **Software licenciado de alta confiança** para clientes com exigência de controle e compliance.
- **Plataforma SaaS recorrente** para escalar aquisição, retenção e receita previsível.

O ativo central permanece o mesmo: uma infraestrutura confiável de descoberta, coleta, leitura e monitoramento de CCTs, já validada em produção.
