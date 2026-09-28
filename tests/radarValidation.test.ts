import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import test from 'node:test';

import { prisma } from '../src/db';
import { createApp } from '../src/server';

test('POST /api/radar/sindicatos/:id/validar valida apenas o enquadramento do sindicato', async () => {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const sindicato = await prisma.sindicato.create({
    data: { cnpj: `99${suffix}`, razaoSocial: 'Sindicato para validação', uf: 'SP', cidade: 'São Paulo' }
  });
  const cliente = await prisma.cliente.create({
    data: {
      cnpj: `88${suffix}`,
      razaoSocial: 'Cliente para validação',
      cnaePrincipal: '6201501',
      descricaoCnae: 'Teste',
      uf: 'SP',
      cidade: 'São Paulo'
    }
  });
  const enquadramento = await prisma.enquadramentoSindical.create({
    data: { clienteId: cliente.id, sindicatoId: sindicato.id, tipo: 'LABORAL', status: 'SUGERIDO_IA' }
  });
  const server = createServer(createApp());
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/radar/sindicatos/${sindicato.id}/validar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.PORTAL_API_KEY ?? 'change-me'
      },
      body: JSON.stringify({ enquadramentoId: enquadramento.id })
    });

    assert.equal(response.status, 200);
    const atualizado = await prisma.enquadramentoSindical.findUnique({ where: { id: enquadramento.id } });
    assert.equal(atualizado?.status, 'VALIDADO_DP');
    const alerta = await prisma.alertaDP.findUnique({ where: { chaveUnica: `VALIDACAO_ENQUADRAMENTO:${enquadramento.id}` } });
    assert.ok(alerta);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});