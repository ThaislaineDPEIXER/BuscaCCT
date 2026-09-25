import { Router } from 'express';
import { assinarAlertas, atualizarAlerta, listarAlertas, StatusAlerta } from '../services/alertService';

export const alertRoutes = Router();

alertRoutes.get('/alertas', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status as StatusAlerta : undefined;
  res.json(await listarAlertas(status));
});

alertRoutes.patch('/alertas/:id/status', async (req, res) => {
  const status = req.body?.status as StatusAlerta;
  if (!['PENDENTE', 'EM_ANALISE', 'RESOLVIDO'].includes(status)) {
    res.status(400).json({ erro: 'status invalido' });
    return;
  }
  try {
    res.json(await atualizarAlerta(req.params.id, status));
  } catch (error) {
    res.status(404).json({ erro: String(error) });
  }
});

alertRoutes.get('/alertas/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(': connected\n\n');
  const cancelar = assinarAlertas(alerta => res.write(`event: alerta\ndata: ${JSON.stringify(alerta)}\n\n`));
  req.on('close', cancelar);
});
