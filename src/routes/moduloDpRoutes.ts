import { Router } from 'express';
import { prisma } from '../db';
import { assinarAlertas, atualizarAlerta, listarAlertas } from '../services/alertService';
import { consultarBuscador, extrairCctComClaude, validarExtracaoCct } from '../services/claudeAgent';
import { persistirExtracaoCct } from '../services/cctExtractionPersistence';
import { buscarESalvarCCT } from '../tools/mteScraper';

export const moduloDpRoutes = Router();

const normalizarCnpj = (valor: string): string => valor.replace(/\D/g, '');

moduloDpRoutes.post('/consultar', async (req, res) => {
  const pergunta = typeof req.body?.pergunta === 'string' ? req.body.pergunta.trim() : '';
  if (!pergunta) {
    res.status(400).json({ erro: 'pergunta e obrigatoria.' });
    return;
  }

  try {
    const resposta = await consultarBuscador(pergunta);
    res.json({ resposta, fonte: 'Tool Use: MTE/IBGE' });
  } catch (error) {
    console.error('[MODULO_DP] Falha na consulta do buscador:', error);
    res.status(502).json({ erro: 'Nao foi possivel concluir a consulta nas fontes oficiais.' });
  }
});

moduloDpRoutes.get('/alertas', async (_req, res) => {
  res.json(await listarAlertas());
});

moduloDpRoutes.get('/alertas/sindicatos', async (_req, res) => {
  const alertas = await listarAlertas();
  res.json(alertas.map(alerta => ({
    nivelCriticidade: alerta.prioridade,
    cnpjSindicato: alerta.sindicatoCnpj,
    clientesImpactados: alerta.clientesImpactados,
    resumo: `${alerta.titulo}: ${alerta.mensagem}`.slice(0, 240),
    titulo: alerta.titulo,
    mensagem: alerta.mensagem,
    tipo: alerta.tipo,
    status: alerta.status
  })));
});

moduloDpRoutes.get('/parametros-cct/:cnpj', async (req, res) => {
  const cnpj = normalizarCnpj(req.params.cnpj);
  if (!cnpj || cnpj.length !== 14) {
    res.status(400).json({ erro: 'CNPJ invalido.' });
    return;
  }

  try {
    const anoAtual = new Date().getFullYear();
    const cct = await prisma.convencaoColetiva.findFirst({
      where: { cnpjSindicato: cnpj },
      orderBy: { anoVigencia: 'desc' }
    });

    const texto = cct?.textoCompleto ?? await buscarESalvarCCT(cnpj, anoAtual);
    let parametros: Awaited<ReturnType<typeof extrairCctComClaude>>;
    let precisaPersistir = !cct?.parametrosJson;
    if (cct?.parametrosJson) {
      try {
        parametros = validarExtracaoCct(JSON.parse(cct.parametrosJson));
      } catch {
        parametros = await extrairCctComClaude(texto);
        precisaPersistir = true;
      }
    } else {
      parametros = await extrairCctComClaude(texto);
    }

    if (precisaPersistir) {
      await persistirExtracaoCct(cnpj, cct?.anoVigencia ?? anoAtual, parametros);
    }

    res.json({
      cnpjSindicato: cnpj,
      anoVigencia: cct?.anoVigencia ?? anoAtual,
      fonteUrl: cct?.fonteUrl ?? 'https://mediador.trabalho.gov.br/sistemas/mediador/ConsultarInstColetivo',
      ...parametros,
      parametros,
      resumo: parametros.resumo_mudancas
    });
  } catch (error) {
    console.error('[MODULO_DP] Falha ao recuperar CCT:', error);
    res.status(502).json({ erro: 'Nao foi possivel localizar ou extrair a CCT do sindicato.' });
  }
});

function abrirStreamAlertas(req: import('express').Request, res: import('express').Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(': connected\n\n');
  const cancelar = assinarAlertas(alerta => res.write(`data: ${JSON.stringify(alerta)}\n\n`));
  req.on('close', cancelar);
}

moduloDpRoutes.get('/alertas/stream', abrirStreamAlertas);
moduloDpRoutes.get('/alertas/events', abrirStreamAlertas);

moduloDpRoutes.get('/dashboard/resumo', async (_req, res) => {
  const [
    totalClientes,
    totalSindicatos,
    totalConvenios,
    totalAlertasPendentes,
    totalImpactos,
    totalContribuicoes,
    clientesMonitorados
  ] = await Promise.all([
    prisma.cliente.count(),
    prisma.sindicato.count(),
    prisma.convencaoColetiva.count(),
    prisma.alertaDP.count({ where: { status: 'PENDENTE' } }),
    prisma.impactoFolha.count(),
    prisma.contribuicaoSindical.count(),
    prisma.enquadramentoSindical.count({ where: { status: 'VALIDADO_DP' } })
  ]);

  res.json({
    totalClientes,
    totalSindicatos,
    totalConvenios,
    totalAlertasPendentes,
    totalImpactos,
    totalContribuicoes,
    clientesMonitorados,
    atualizadoEm: new Date().toISOString()
  });
});

moduloDpRoutes.get('/dashboard/impactos', async (_req, res) => {
  const impactos = await prisma.impactoFolha.findMany({
    orderBy: { criadoEm: 'desc' },
    take: 10,
    include: {
      convencaoColetiva: {
        select: {
          id: true,
          anoVigencia: true,
          resumoCct: true,
          sindicato: { select: { cnpj: true, razaoSocial: true } }
        }
      }
    }
  });

  res.json(impactos.map(impacto => ({
    id: impacto.id,
    categoria: impacto.categoria,
    descricao: impacto.descricao,
    valorAnterior: impacto.valorAnterior,
    valorNovo: impacto.valorNovo,
    percentual: impacto.percentual,
    vigencia: impacto.vigencia,
    status: impacto.status,
    cct: {
      id: impacto.convencaoColetiva.id,
      anoVigencia: impacto.convencaoColetiva.anoVigencia,
      resumo: impacto.convencaoColetiva.resumoCct,
      sindicatoCnpj: impacto.convencaoColetiva.sindicato.cnpj,
      sindicatoRazaoSocial: impacto.convencaoColetiva.sindicato.razaoSocial
    },
    criadoEm: impacto.criadoEm
  })));
});

moduloDpRoutes.patch('/alertas/:id/concluir', async (req, res) => {
  try {
    res.json(await atualizarAlerta(req.params.id, 'RESOLVIDO'));
  } catch (error) {
    res.status(404).json({ erro: String(error) });
  }
});

