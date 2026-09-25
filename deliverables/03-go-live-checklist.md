# Checklist definitivo de Go-Live em 7 dias

## Objetivo

Liberar o projeto BuscaCCT para operação em ambiente de produção real, garantindo estabilidade técnica, funcionalidade do scraper, dados do negócio e integração com o portal.

## Dia 1 — Infraestrutura e banco
- Provisionar PostgreSQL em ambiente de homologação/produção.
- Validar Docker Compose para API e worker.
- Preencher variáveis de ambiente com dados reais.
- Verificar conectividade e backup do banco.
- Rodar Prisma e validar schema.

## Dia 2 — API e worker
- Executar API principal em ambiente funcional.
- Executar o worker isolado.
- Validar healthcheck e logs.
- Confirmar rotina de atualização diária.
- Verificar reinício automático e alertas críticos.

## Dia 3 — CAPTCHA e acesso externo
- Solicitar aprovação do serviço de CAPTCHA.
- Validar o provedor em testes reais.
- Validar acesso ao Sistema Mediador.
- Confirmar fallback de timeout, retry e logs.
- Testar a operação com volume reduzido.

## Dia 4 — Dados de negócio
- Exportar carteira de clientes do ERP.
- Exportar sindicatos e territórios.
- Normalizar os dados para o formato exigido pelo `seed.ts`.
- Rodar importação inicial.
- Validar regras de relacionamento e territórios.

## Dia 5 — Fluxo de negócio e alertas
- Verificar geração de alertas.
- Validar Action Inbox.
- Confirmar o fluxo de enquadramento sindical.
- Testar conclinação e acompanhamento do analista.
- Validar deduplicação e priorização.

## Dia 6 — Portal e SSE
- Documentar endpoints e contratos de resposta.
- Integrar o componente React do Copiloto no portal.
- Validar SSE e atualizações em tempo real.
- Testar consulta e resposta da API com dados reais.
- Ajustar UX e mensagens de erro.

## Dia 7 — Validação final e liberação
- Executar testes de integração com dados reais limitados.
- Validar execução de rotina diária e alertas.
- Validar monitoramento e webhook de TI.
- Revisar riscos e plano de rollback.
- Aprovar liberação para produção.

## Critérios de liberação
- API funcionando e estável.
- Worker processando sem falhas críticas.
- Banco PostgreSQL funcionando corretamente.
- CAPTCHA validado para o cenário real.
- MTE acessado com controle de timeouts e retries.
- Dados reais importados e validados.
- Portal integrado e funcional.
- Alertas e SSE operando.
- Logs e monitoramento ativos.

## Risco principal a monitorar
O maior risco em produção continua sendo o bloqueio externo do MTE e a dependência de serviços de terceiros. Por isso, a operação deve manter controle estrito de logs, timeout e alertas de falha.

---

> A ordem correta de execução é: infraestrutura, CAPTCHA, dados reais, portal, homologação final.
