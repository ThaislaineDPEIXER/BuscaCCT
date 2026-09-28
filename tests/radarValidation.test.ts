import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import test from 'node:test';

import { prisma } from '../src/db';
import { createApp } from '../src/server';

async function criarVinculo() {
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
  return { sindicato, enquadramento };
}

async function validar(sindicatoId: string, body: Record<string, unknown>) {
  const server = createServer(createApp());
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await fetch(`http://127.0.0.1:${port}/api/radar/sindicatos/${sindicatoId}/validar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.PORTAL_API_KEY ?? 'change-me' },
      body: JSON.stringify(body)
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('POST /api/radar/sindicatos/:id/validar confirma e registra a auditoria', async () => {
  const { sindicato, enquadramento } = await criarVinculo();

  const response = await validar(sindicato.id, {
    enquadramentoId: enquadramento.id,
    validadoPor: 'contador@empresa.com',
    grau: 'PREPONDERANTE',
    observacoes: 'Atividade com maior número de empregados.'
  });

  assert.equal(response.status, 200);
  const atualizado = await prisma.enquadramentoSindical.findUnique({ where: { id: enquadramento.id } });
  assert.equal(atualizado?.status, 'VALIDADO_DP');
  assert.equal(atualizado?.validadoPor, 'contador@empresa.com');
  assert.equal(atualizado?.grau, 'PREPONDERANTE');
  assert.ok(atualizado?.validadoEm);
  const alerta = await prisma.alertaDP.findUnique({ where: { chaveUnica: `VALIDACAO_ENQUADRAMENTO:${enquadramento.id}` } });
  assert.ok(alerta);
});

test('POST /api/radar/sindicatos/:id/validar rejeita vínculo e exige responsável', async () => {
  const { sindicato, enquadramento } = await criarVinculo();

  const semResponsavel = await validar(sindicato.id, { enquadramentoId: enquadramento.id });
  assert.equal(semResponsavel.status, 400);
  const grauInvalido = await validar(sindicato.id, { enquadramentoId: enquadramento.id, validadoPor: 'RH', grau: 'OUTRO' });
  assert.equal(grauInvalido.status, 400);

  const rejeitado = await validar(sindicato.id, { enquadramentoId: enquadramento.id, validadoPor: 'RH', decisao: 'REJEITADO' });
  assert.equal(rejeitado.status, 200);
  const atualizado = await prisma.enquadramentoSindical.findUnique({ where: { id: enquadramento.id } });
  assert.equal(atualizado?.status, 'REJEITADO');
});