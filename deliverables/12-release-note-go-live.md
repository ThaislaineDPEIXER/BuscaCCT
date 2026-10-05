# Release Note — Go-Live Técnico do Radar CCT

## Resumo

Esta entrega consolida o Radar CCT como um pipeline autônomo, resiliente e pronto para operação assistida por nuvem, reduzindo o impacto de bloqueios do portal Mediador e fortalecendo a confiabilidade do processamento ponta a ponta.

## Principais melhorias

- Fallback automático do MTE para o site oficial do sindicato quando houver anti-bot, CAPTCHA, pendência manual prévia ou ausência de resultado utilizável.
- Orquestração dinâmica do provedor de IA, com suporte consistente a `Gemini` e `Anthropic` em readiness e rotinas de extração.
- Alinhamento da infraestrutura e dos workflows auxiliares para `Node 22`, compatível com o runtime exigido pelo projeto.
- Exposição padronizada do PostgreSQL local para testes automatizados e validação reproduzível do pipeline.
- Expansão da cobertura automatizada para serviços core e rotas HTTP críticas.

## Resultado da validação

- `npm run typecheck`: aprovado
- `npm test`: aprovado
- `npm run build`: aprovado
- Suíte automatizada: `86` testes verdes

## Impacto operacional

- O bloqueio do MTE deixa de ser interrupção crítica e passa a ser tratado como desvio operacional silencioso, com reaproveitamento automático do fallback por site quando disponível.
- O fluxo manual de upload de PDF permanece apenas como contingência operacional, não mais como caminho principal.
- O backend segue pronto para a etapa final de go-live dependente de secrets reais, conectividade externa e validação em produção assistida.

## Pendências externas ao código

- Confirmar secrets de produção no GitHub Actions e serviços externos.
- Validar credenciais reais do Supabase/PostgreSQL, Google Drive/Sheets e provedor de IA.
- Executar fumaça final em ambiente de produção com sindicatos reais monitorados.
