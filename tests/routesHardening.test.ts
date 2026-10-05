import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';

import { createApp } from '../src/server';
import { prisma } from '../src/db';

async function startTestServer(): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  const app = createApp();
  const server = createServer(app);
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Não foi possível obter a porta do servidor de teste.');
  return { server, port: (address as AddressInfo).port };
}

test('GET /api/alertas lista os alertas persistidos', async () => {
  const { server, port } = await startTestServer();
  try {
    const sindicato = await prisma.sindicato.create({
      data: { cnpj: `41${Date.now().toString().slice(-12)}`.slice(0, 14), razaoSocial: 'Sindicato Alertas', uf: 'SC', cidade: 'Itajaí' }
    });
    await prisma.alertaDP.create({
      data: {
        sindicatoCnpj: sindicato.cnpj,
        titulo: 'Novo alerta',
        mensagem: 'Mensagem de teste',
        tipo: 'NOTICIA_SITE',
        prioridade: 'ALTA'
      }
    });

    const response = await fetch(`http://127.0.0.1:${port}/api/alertas`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body));
    assert.ok(body.some((item: { titulo: string; sindicato: { cnpj: string } }) => item.titulo === 'Novo alerta' && item.sindicato.cnpj === sindicato.cnpj));
  } finally {
    server.close();
  }
});

test('PATCH /api/alertas/:id/status rejeita status inválido', async () => {
  const { server, port } = await startTestServer();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/alertas/inexistente/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'QUALQUER_COISA' })
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.erro, /status invalido/i);
  } finally {
    server.close();
  }
});

test('PATCH /api/alertas/:id/status atualiza um alerta existente', async () => {
  const { server, port } = await startTestServer();
  try {
    const sindicato = await prisma.sindicato.create({
      data: { cnpj: `42${Date.now().toString().slice(-12)}`.slice(0, 14), razaoSocial: 'Sindicato Resolve', uf: 'SC', cidade: 'Penha' }
    });
    const alerta = await prisma.alertaDP.create({
      data: {
        sindicatoCnpj: sindicato.cnpj,
        titulo: 'Alerta pendente',
        mensagem: 'Mensagem',
        tipo: 'DATA_BASE_PROXIMA',
        prioridade: 'MEDIA'
      }
    });

    const response = await fetch(`http://127.0.0.1:${port}/api/alertas/${alerta.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'RESOLVIDO' })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'RESOLVIDO');
  } finally {
    server.close();
  }
});

test('GET /api/enquadramentos aceita filtro por clienteId', async () => {
  const { server, port } = await startTestServer();
  try {
    const sindicato = await prisma.sindicato.create({
      data: { cnpj: `43${Date.now().toString().slice(-12)}`.slice(0, 14), razaoSocial: 'Sindicato Filtro', uf: 'SC', cidade: 'Joinville' }
    });
    const clienteA = await prisma.cliente.create({
      data: { cnpj: `51${Date.now().toString().slice(-12)}`.slice(0, 14), razaoSocial: 'Cliente A', cnaePrincipal: '6201501', descricaoCnae: 'TI', uf: 'SC', cidade: 'Joinville' }
    });
    const clienteB = await prisma.cliente.create({
      data: { cnpj: `52${Date.now().toString().slice(-12)}`.slice(0, 14), razaoSocial: 'Cliente B', cnaePrincipal: '6201501', descricaoCnae: 'TI', uf: 'SC', cidade: 'Joinville' }
    });
    await prisma.enquadramentoSindical.createMany({ data: [
      { clienteId: clienteA.id, sindicatoId: sindicato.id, tipo: 'LABORAL', status: 'SUGERIDO_IA' },
      { clienteId: clienteB.id, sindicatoId: sindicato.id, tipo: 'PATRONAL', status: 'VALIDADO_DP' }
    ] });

    const response = await fetch(`http://127.0.0.1:${port}/api/enquadramentos?clienteId=${clienteA.id}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 1);
    assert.equal(body[0].clienteId, clienteA.id);
  } finally {
    server.close();
  }
});

test('PATCH /api/enquadramentos/:id/validar devolve 404 para vínculo inexistente', async () => {
  const { server, port } = await startTestServer();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/enquadramentos/inexistente/validar`, { method: 'PATCH' });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.match(body.erro, /Enquadramento nao encontrado/);
  } finally {
    server.close();
  }
});
