import { Router } from 'express';
import { buscarCctNoSite, estadoFallbackSindicato, importarSindicatos, varrerSindicato } from '../services/radarDiscovery';
import { prisma } from '../db';

export const radarRoutes = Router();

radarRoutes.post('/sindicatos/importar', async (req, res) => {
  const registros = req.body?.sindicatos;
  if (!Array.isArray(registros)) {
    res.status(400).json({ erro: 'sindicatos deve ser uma lista da base da Receita Federal.' });
    return;
  }
  try {
    const importados = await importarSindicatos(registros);
    res.status(201).json({ importados });
  } catch (error) {
    res.status(400).json({ erro: String(error) });
  }
});

radarRoutes.get('/sindicatos', async (req, res) => {
  const sindicatos = await prisma.sindicato.findMany({
    where: { ativo: req.query.ativo === undefined ? undefined : req.query.ativo === 'true' },
    orderBy: [{ uf: 'asc' }, { cidade: 'asc' }],
    include: { varreduras: { orderBy: { consultadoEm: 'desc' }, take: 1 } }
  });
  res.json(sindicatos);
});

radarRoutes.get('/sindicatos/:id', async (req, res) => {
  const sindicato = await prisma.sindicato.findUnique({
    where: { id: req.params.id },
    include: { varreduras: { orderBy: { consultadoEm: 'desc' }, take: 5 } }
  });

  if (!sindicato) {
    res.status(404).json({ erro: 'Sindicato nao encontrado.' });
    return;
  }

  res.json({
    ...sindicato,
    ultimaVarreduraSite: sindicato.ultimaVarreduraSite ?? sindicato.ultimaVarredura,
    ultimoScan: sindicato.varreduras[0] ?? null
  });
});

radarRoutes.get('/sindicatos/:id/fallback', async (req, res) => {
  try {
    const estado = await estadoFallbackSindicato(req.params.id);
    res.json(estado);
  } catch (error) {
    console.error('[RADAR] Falha no fallback do sindicato:', error);
    res.status(404).json({ erro: 'Sindicato nao encontrado.' });
  }
});

radarRoutes.post('/sindicatos/:id/validar', async (req, res) => {
  const enquadramentoId = req.body?.enquadramentoId;
  if (typeof enquadramentoId !== 'string' || !enquadramentoId) {
    res.status(400).json({ erro: 'enquadramentoId é obrigatório.' });
    return;
  }

  const enquadramento = await prisma.$transaction(async tx => {
    const existente = await tx.enquadramentoSindical.findFirst({
      where: { id: enquadramentoId, sindicatoId: req.params.id },
      include: { sindicato: { select: { cnpj: true } } }
    });
    if (!existente) return null;

    const atualizado = await tx.enquadramentoSindical.update({
      where: { id: existente.id },
      data: { status: 'VALIDADO_DP' }
    });
    await tx.alertaDP.upsert({
      where: { chaveUnica: `VALIDACAO_ENQUADRAMENTO:${existente.id}` },
      create: {
        sindicatoCnpj: existente.sindicato.cnpj,
        titulo: 'Enquadramento validado pelo DP',
        mensagem: `Enquadramento ${existente.id} validado para o sindicato ${req.params.id}.`,
        tipo: 'VALIDACAO_ENQUADRAMENTO',
        prioridade: 'BAIXA',
        chaveUnica: `VALIDACAO_ENQUADRAMENTO:${existente.id}`
      },
      update: { dataAtualizacao: new Date() }
    });
    return atualizado;
  });

  if (!enquadramento) {
    res.status(404).json({ erro: 'Enquadramento não encontrado para este sindicato.' });
    return;
  }

  res.json({ enquadramento, status: 'VALIDADO_DP' });
});

radarRoutes.post('/sindicatos/:id/fallback/cct', async (req, res) => {
  try {
    const resultado = await buscarCctNoSite(req.params.id);
    res.status(201).json({ fonte: 'site', ...resultado });
  } catch (error) {
    console.error('[RADAR] Falha ao capturar CCT pelo site:', error);
    res.status(502).json({
      erro: error instanceof Error ? error.message : 'Falha ao capturar CCT pelo site do sindicato.'
    });
  }
});

radarRoutes.post('/sindicatos/:id/varrer', async (req, res) => {
  try {
    const resultado = await varrerSindicato(req.params.id);
    res.json(resultado);
  } catch (error) {
    console.error('[RADAR] Falha na varredura:', error);
    res.status(502).json({ erro: 'Falha ao varrer o site do sindicato.' });
  }
});
