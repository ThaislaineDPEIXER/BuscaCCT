# Documento Executivo Final — BuscaCCT

## 1. Visão geral

O projeto BuscaCCT foi validado como backend funcional e pronto para a fase de implantação operacional. O foco agora deixa de ser a concepção e passa a ser a gestão da entrada em produção com segurança, previsibilidade e governança.

A solução foi desenhada para operar como um motor de busca, extração, validação e alerta de Convenções Coletivas de Trabalho (CCTs), com foco direto na rotina da contabilidade e do Departamento Pessoal.

O sistema foi estruturado para:
- buscar CCTs em fontes oficiais;
- criar cache local com persistência;
- extrair regras estruturadas com IA;
- identificar mudanças relevantes;
- disponibilizar alertas e parâmetro de integração ao portal;
- apoiar a equipe do DP com Action Inbox e fluxo guiado.

---

## 2. Objetivo estratégico

O objetivo do projeto não é simplesmente "buscar documentos". O objetivo é transformar uma rotina manual e reativa em um processo automatizado e proativo de monitoramento sindical.

A proposta é reduzir:
- retrabalho operacional;
- risco de não atualização de regras sindicais;
- tempo de investigação manual; 
- dependência de trabalho humano repetitivo.

A vantagem é permitir que a contabilidade trabalhe com alertas confiáveis, dados estruturados e acompanhamento das mudanças legais e sindicais em tempo útil.

---

## 3. Escopo técnico validado

A solução já foi validada em engenharia e está pronta para a fase de produção. O backend foi implementado em Node.js + TypeScript, com Prisma, Express, cron jobs, worker separado, alertas e configuração de API.

### Componentes principais

- API principal para consultas do portal
- worker isolado para rotinas diárias e monitoramento
- banco para persistência de dados e cache
- integração com Claude para extração estruturada
- crawler MTE com controle de retry e cache
- mecanismos de alertas e Action Inbox
- suporte a OCR para PDFs escaneados
- endpoints para a equipe do frontend consumir diretamente

---

## 4. Arquitetura recomendada para produção

A arquitetura correta para produção é a que reduz riscos e manutenção operacional. Portanto, o modelo recomendado é:

### Banco
- Google Cloud SQL PostgreSQL
- backups diários automáticos
- proteção contra exclusão acidental
- rede interna / VPC
- conexão segura e sem exposição pública da porta do banco

### Armazenamento
- Google Cloud Storage
- bucket exclusivo para PDFs e arquivos do fluxo
- ausência de dependência de discos locais da VM
- persistência e recuperação simplificadas

### Execução da aplicação
- Compute Engine com Ubuntu
- Docker Compose para subir API e worker
- VM stateless
- infraestrutura mais simples e mais resiliente

### Segurança
- Service Account do Google com permissões mínimas
- chave JSON em ambiente controlado da aplicação
- `GOOGLE_APPLICATION_CREDENTIALS` para autenticação silenciosa

---

## 5. Justificativa de investimento para a diretoria

O serviço de CAPTCHA não é um custo opcional; ele é uma dependência do fluxo operacional.

### Ponto central

Sem o serviço de resolução automatizada de CAPTCHA, o sistema fica vulnerável a bloqueios do MTE e a necessidade de consulta manual. Isso cria uma operação que se torna lenta, pouco escalável e sujeito a erro humano.

### Benefício financeiro real

O custo do serviço é pequeno e previsível, enquanto o custo da operação manual é elevado e recorrente.

### Comparativo objetivo

- CAPTCHA: custo baixo, previsível e automatizado
- DP manual: dezenas de horas de trabalho repetitivo
- atraso em atualizações: risco operacional e perda de produtividade

### Conclusão executiva

O investimento em CAPTCHA elimina gargalo de automação, reduz retrabalho e protege a operação contra atrasos e erros na rotina de monitoramento sindical.

---

## 6. Ordem correta de execução do Go-Live

A execução deve seguir esta ordem para reduzir risco:

### Fase 1 — Infraestrutura e backend
- provisionar Cloud SQL PostgreSQL
- configurar ambiente de produção
- validar banco e Prisma
- levantar API e worker
- definir logs, saúde e webhooks de falha

### Fase 2 — CAPTCHA e operação externa
- aprovar o serviço de CAPTCHA
- validar acesso ao MTE com retenção de timeouts e retries
- confirmar fluxo de busca e processamento

### Fase 3 — Dados reais do ERP
- exportar clientes e sindicatos
- normalizar campos para o formato do `seed.ts`
- validar base inicial
- realizar importação em homologação antes da produção

### Fase 4 — Frontend e portal
- integrar API da Action Inbox
- conectar SSE
- integrar Copiloto de consulta e parametrização
- validar experiência do profissional do DP

### Fase 5 — Homologação e liberação
- testar operação real em ambiente controlado
- validar alertas, dados e monitoramento
- liberar produção com checklist final

---

## 7. Checklist de infraestrutura e operação

### TI / Backend
- [ ] Cloud SQL PostgreSQL configurado
- [ ] backups automáticos ativados
- [ ] proteção contra exclusão acidental habilitada
- [ ] bucket do Cloud Storage criado
- [ ] Service Account criado
- [ ] chave JSON gerada e armazenada em local seguro
- [ ] API e worker rodando em containers separados
- [ ] healthcheck e logs configurados
- [ ] webhook de TI ativo

### Operação / DP
- [ ] exportação do ERP validada
- [ ] clientes e sindicatos normalizados
- [ ] seed executado corretamente
- [ ] regras de território e enquadramento revisadas
- [ ] alertas funcionando e priorizados corretamente

### Frontend / Portal
- [ ] endpoints da API documentados
- [ ] SSE configurado
- [ ] Action Inbox integrada
- [ ] Copiloto de parâmetros acessível
- [ ] experiência do usuário validada

---

## 8. Regras de integração com o portal

A interface do portal deve consumir os seguintes principais endpoints:

### Consulta
- `POST /api/modulo-dp/consultar`

### Alertas
- `GET /api/modulo-dp/alertas`
- `GET /api/modulo-dp/alertas/sindicatos`
- `GET /api/modulo-dp/alertas/stream`
- `PATCH /api/modulo-dp/alertas/:id/concluir`

### Parâmetros da CCT
- `GET /api/modulo-dp/parametros-cct/:cnpj`

A Action Inbox deve ter atualização em tempo real e o Copiloto deve consumir os parâmetros estruturados da CCT para permitir revisão humana e atualização do ERP.

---

## 9. Critérios de aprovação para Go-Live

O sistema pode ser liberado para produção somente quando:
- infra do banco estiver funcional em GCP;
- storage para PDFs estiver ativo;
- API e worker estiverem operando de forma isolada;
- CAPTCHA estiver validado e aprovado;
- busca no MTE estiver estável;
- extração do Claude estiver gerando JSON confiável;
- alertas e Action Inbox estiverem funcionando;
- dados do ERP estiverem importados e validados;
- a equipe do frontend tiver integrado o fluxo do portal;
- logs e monitoramento estiverem ativos.

---

## 10. Conclusão executiva

O projeto BuscaCCT já atingiu o estágio em que a maior parte da engenharia foi validada e a atenção agora deve ser dedicada à implantação e ao controle operacional.

A decisão correta é seguir uma implantação em camadas, começando pela infraestrutura sólida, depois pela automação externa, depois pelos dados reais e, por fim, pela integração com o portal.

Em outras palavras:
- a base técnica precisa ser robusta;
- o CAPTCHA precisa ser aprovado;
- os dados reais devem ser importados com disciplina;
- o frontend precisa consumir a API sem adivinhação;
- a operação precisa ser gerenciada em produção com monitoramento e alertas.

Com isso, o projeto deixa de ser um protótipo funcional e se torna um sistema operacional, com governança, rastreabilidade e valor direto para a contabilidade.

---

## 11. Encaminhamento final

Este documento serve como material executivo e operacional para a diretoria, a TI e a equipe do portal. Ele sintetiza a arquitetura proposta, o valor do investimento, a ordem de execução e os critérios claros para o Go-Live.

Com a engenharia validada, o próximo passo é a execução disciplinada da implantação e a liberação em produção, em etapas, com evidência e controle.
