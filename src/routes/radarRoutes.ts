import { Router } from 'express';
import { buscarCctNoSite, estadoFallbackSindicato, importarSindicatos, varrerSindicato } from '../services/radarDiscovery';
import { GRAUS_ENQUADRAMENTO, STATUS_ENQUADRAMENTO } from '../services/enquadramentoStatus';
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
  const { enquadramentoId, validadoPor, observacoes } = req.body ?? {};
  const decisao: unknown = req.body?.decisao ?? 'CONFIRMADO';
  const grau: unknown = req.body?.grau;
  if (typeof enquadramentoId !== 'string' || !enquadramentoId) {
    res.status(400).json({ erro: 'enquadramentoId é obrigatório.' });
    return;
  }
  if (typeof validadoPor !== 'string' || !validadoPor.trim()) {
    res.status(400).json({ erro: 'validadoPor é obrigatório (nome ou e-mail do responsável).' });
    return;
  }
  if (decisao !== 'CONFIRMADO' && decisao !== 'REJEITADO') {
    res.status(400).json({ erro: 'decisao deve ser CONFIRMADO ou REJEITADO.' });
    return;
  }
  if (grau !== undefined && (typeof grau !== 'string' || !(GRAUS_ENQUADRAMENTO as readonly string[]).includes(grau))) {
    res.status(400).json({ erro: `grau deve ser um de: ${GRAUS_ENQUADRAMENTO.join(', ')}.` });
    return;
  }
  if (observacoes !== undefined && typeof observacoes !== 'string') {
    res.status(400).json({ erro: 'observacoes deve ser texto.' });
    return;
  }
  const status = STATUS_ENQUADRAMENTO[decisao];

  const enquadramento = await prisma.$transaction(async tx => {
    const existente = await tx.enquadramentoSindical.findFirst({
      where: { id: enquadramentoId, sindicatoId: req.params.id },
      include: { sindicato: { select: { cnpj: true } } }
    });
    if (!existente) return null;

    const atualizado = await tx.enquadramentoSindical.update({
      where: { id: existente.id },
      data: {
        status,
        validadoPor: validadoPor.trim(),
        validadoEm: new Date(),
        ...(typeof grau === 'string' ? { grau } : {}),
        ...(observacoes !== undefined ? { observacoes: observacoes.trim() || null } : {})
      }
    });
    await tx.alertaDP.upsert({
      where: { chaveUnica: `VALIDACAO_ENQUADRAMENTO:${existente.id}` },
      create: {
        sindicatoCnpj: existente.sindicato.cnpj,
        titulo: decisao === 'CONFIRMADO' ? 'Enquadramento confirmado pelo DP' : 'Enquadramento rejeitado pelo DP',
        mensagem: `Enquadramento ${existente.id} ${decisao.toLowerCase()} por ${validadoPor.trim()}.`,
        tipo: 'VALIDACAO_ENQUADRAMENTO',
        prioridade: 'BAIXA',
        chaveUnica: `VALIDACAO_ENQUADRAMENTO:${existente.id}`
      },
      update: {
        titulo: decisao === 'CONFIRMADO' ? 'Enquadramento confirmado pelo DP' : 'Enquadramento rejeitado pelo DP',
        mensagem: `Enquadramento ${existente.id} ${decisao.toLowerCase()} por ${validadoPor.trim()}.`
      }
    });
    return atualizado;
  });

  if (!enquadramento) {
    res.status(404).json({ erro: 'Enquadramento não encontrado para este sindicato.' });
    return;
  }

  res.json({ enquadramento, decisao });
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
