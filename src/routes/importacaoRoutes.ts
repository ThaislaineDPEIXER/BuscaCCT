import express, { Router } from 'express';
import { prisma } from '../db';
import { importarClientesCsv, importarClientesXlsx } from '../services/importacaoService';

export const importacaoRoutes = Router();

importacaoRoutes.post('/importacao/clientes/xlsx', express.raw({
  type: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream'
  ],
  limit: '10mb'
}), async (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body)) {
      res.status(400).json({ erro: 'Envie o arquivo Excel como corpo binário da requisição.' });
      return;
    }

    const resultado = await importarClientesXlsx(req.body, 'importacao-clientes.xlsx');
    res.status(201).json(resultado);
  } catch (error) {
    res.status(400).json({ erro: error instanceof Error ? error.message : String(error) });
  }
});

importacaoRoutes.post('/importacao/clientes', async (req, res) => {
  try {
    const textoCsv = typeof req.body === 'string'
      ? req.body
      : typeof req.body?.csv === 'string'
        ? req.body.csv
        : '';

    if (!textoCsv) {
      if (Array.isArray(req.body?.linhas)) {
        const linhas = req.body.linhas as Record<string, string>[];
        const csv = [
          Object.keys(linhas[0] ?? {}).join(','),
          ...linhas.map(linha => Object.values(linha).join(','))
        ].join('\n');

        const resultado = await importarClientesCsv(csv, 'importacao-json.csv');
        res.status(201).json(resultado);
        return;
      }

      res.status(400).json({ erro: 'Informe um CSV em text/csv ou um campo csv.' });
      return;
    }

    const resultado = await importarClientesCsv(textoCsv, 'importacao-clientes.csv');
    res.status(201).json(resultado);
  } catch (error) {
    res.status(400).json({ erro: error instanceof Error ? error.message : String(error) });
  }
});

importacaoRoutes.get('/importacao/lotes/:id', async (req, res) => {
  const lote = await prisma.importacaoLote.findUnique({
    where: { id: req.params.id },
    include: { linhas: { orderBy: { numeroLinha: 'asc' } } }
  });

  if (!lote) {
    res.status(404).json({ erro: 'Lote de importação não encontrado.' });
    return;
  }

  res.json(lote);
});
