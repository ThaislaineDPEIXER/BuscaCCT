import { Router } from 'express';
import { criarClienteESugerir, listarEnquadramentos, listarSindicatosMonitorados, validarEnquadramento } from '../services/enquadramentoService';

export const enquadramentoRoutes = Router();

enquadramentoRoutes.post('/clientes/sugerir', async (req, res) => {
  try {
    const resultado = await criarClienteESugerir(req.body);
    res.status(201).json(resultado);
  } catch (error) {
    console.error('[ENQUADRAMENTO] Falha na sugestao:', error);
    res.status(400).json({ erro: String(error) });
  }
});

enquadramentoRoutes.get('/enquadramentos', async (req, res) => {
  const clienteId = typeof req.query.clienteId === 'string' ? req.query.clienteId : undefined;
  res.json(await listarEnquadramentos(clienteId));
});

enquadramentoRoutes.patch('/enquadramentos/:id/validar', async (req, res) => {
  try {
    res.json(await validarEnquadramento(req.params.id));
  } catch (error) {
    res.status(404).json({ erro: String(error) });
  }
});

enquadramentoRoutes.get('/sindicatos-monitorados', async (_req, res) => {
  res.json(await listarSindicatosMonitorados());
});
