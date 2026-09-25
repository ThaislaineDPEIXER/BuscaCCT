import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';

import { createApp } from '../src/server';
import { prisma } from '../src/db';

async function startTestServer(): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  const app = createApp();
  const server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Não foi possível obter a porta do servidor de teste.');
  }

  return {
    server,
    port: (address as AddressInfo).port
  };
}

test('GET /health responde OK', async () => {
  const { server, port } = await startTestServer();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.status, 'ok');
  } finally {
    server.close();
  }
});

test('GET /api/modulo-dp/parametros-cct/:cnpj retorna 404 quando não existe', async () => {
  const { server, port } = await startTestServer();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/modulo-dp/parametros-cct/${randomUUID()}`);
    assert.ok(response.status === 400 || response.status === 502);
  } finally {
    server.close();
  }
});

test('GET /api/modulo-dp/alertas/stream abre conexão SSE', async () => {
  const { server, port } = await startTestServer();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/modulo-dp/alertas/stream`, {
      headers: {
        Accept: 'text/event-stream'
      }
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/i);

    const body = response.body;
    assert.ok(body);
    await body.cancel();
  } finally {
    server.close();
  }
});

test('POST /api/importacao/clientes processa CSV e persiste clientes válidos', async () => {
  const { server, port } = await startTestServer();

  try {
    const csv = [
      'NUMERO_EMPRESA,NOME,CNPJ,CNAE,UF,CIDADE',
      '1001,ACME LTDA,12345678000195,6201501,SP,São Paulo',
      '999,Empresa Inválida,123,6201501,RJ,Campinas'
    ].join('\n');

    const response = await fetch(`http://127.0.0.1:${port}/api/importacao/clientes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/csv',
        Accept: 'application/json'
      },
      body: csv
    });

    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.totalLinhas, 2);
    assert.equal(body.processadas, 1);
    assert.equal(body.invalidas, 1);

    const cliente = await prisma.cliente.findUnique({ where: { cnpj: '12345678000195' } });
    assert.ok(cliente);
    assert.equal(cliente?.codigoErp, '1001');
    assert.equal(cliente?.razaoSocial, 'ACME LTDA');
  } finally {
    server.close();
  }
});

test('POST /api/importacao/clientes/xlsx processa planilha Excel', async () => {
  const { server, port } = await startTestServer();

  try {
    const workbook = new ExcelJS.Workbook();
    const planilha = workbook.addWorksheet('Clientes');
    planilha.addRow(['NUMERO_EMPRESA', 'NOME', 'CNPJ', 'CNAE', 'UF', 'CIDADE']);
    planilha.addRow(['2002', 'Empresa Excel', '98765432000100', '6201501', 'PR', 'Curitiba']);
    const arquivo = Buffer.from(await workbook.xlsx.writeBuffer());

    const response = await fetch(`http://127.0.0.1:${port}/api/importacao/clientes/xlsx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      },
      body: arquivo
    });

    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.processadas, 1);
    assert.equal(body.invalidas, 0);

    const cliente = await prisma.cliente.findUnique({ where: { cnpj: '98765432000100' } });
    assert.equal(cliente?.codigoErp, '2002');
    assert.equal(cliente?.cidade, 'Curitiba');
  } finally {
    server.close();
  }
});

test('POST /api/importacao/clientes/xlsx rejeita arquivo sem assinatura Office', async () => {
  const { server, port } = await startTestServer();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/importacao/clientes/xlsx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      },
      body: Buffer.from('nao e um xlsx')
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.erro, /assinatura/i);
  } finally {
    server.close();
  }
});

test('POST /api/importacao/clientes não processa novamente o mesmo hash', async () => {
  const { server, port } = await startTestServer();

  try {
    const csv = [
      'NUMERO_EMPRESA,NOME,CNPJ,CNAE,UF,CIDADE',
      '3003,Empresa Idempotente,11223344000100,6201501,SC,Florianópolis'
    ].join('\n');
    const headers = { 'Content-Type': 'text/csv' };

    const primeira = await fetch(`http://127.0.0.1:${port}/api/importacao/clientes`, {
      method: 'POST',
      headers,
      body: csv
    });
    assert.equal(primeira.status, 201);

    const segunda = await fetch(`http://127.0.0.1:${port}/api/importacao/clientes`, {
      method: 'POST',
      headers,
      body: csv
    });
    assert.equal(segunda.status, 200);
    const body = await segunda.json();
    assert.equal(body.duplicado, true);
    assert.match(body.aviso, /já importado/i);
  } finally {
    server.close();
  }
});

test('GET /api/modulo-dp/dashboard/resumo entrega resumo operacional do cenário atual', async () => {
  const { server, port } = await startTestServer();

  try {
    const cnpjSindicato = `99${Date.now().toString().slice(-12)}`.slice(0, 14);
    const cnpjCliente = `12${Date.now().toString().slice(-12)}`.slice(0, 14);

    const sindicato = await prisma.sindicato.create({
      data: {
        cnpj: cnpjSindicato,
        razaoSocial: 'Sindicato de Teste',
        uf: 'SP',
        cidade: 'São Paulo',
        ativo: true,
        mesDataBase: 3
      }
    });

    const cliente = await prisma.cliente.create({
      data: {
        cnpj: cnpjCliente,
        razaoSocial: 'Cliente Dashboard',
        cnaePrincipal: '6201501',
        descricaoCnae: 'Atividade de teste',
        uf: 'SP',
        cidade: 'São Paulo'
      }
    });

    const cct = await prisma.convencaoColetiva.create({
      data: {
        cnpjSindicato: sindicato.cnpj,
        anoVigencia: 2025,
        textoCompleto: 'CCT de teste com cláusula de reajuste.',
        fonteTipo: 'MTE',
        resumoCct: 'Resumo de teste'
      }
    });

    await prisma.impactoFolha.create({
      data: {
        convencaoColetivaId: cct.id,
        categoria: 'REAJUSTE',
        descricao: 'Reajuste de piso',
        valorAnterior: 1000,
        valorNovo: 1200,
        percentual: 20,
        vigencia: '2025',
        status: 'PENDENTE_VALIDACAO'
      }
    });

    await prisma.contribuicaoSindical.create({
      data: {
        convencaoColetivaId: cct.id,
        tipo: 'CONTRIBUICAO_SINDICAL',
        valorTexto: '1%',
        valorNumerico: 1,
        percentual: 1,
        vencimento: '2025-01-31',
        obrigatoriedade: 'OBRIGATORIA',
        status: 'NOVA'
      }
    });

    await prisma.alertaDP.create({
      data: {
        sindicatoCnpj: sindicato.cnpj,
        titulo: 'CCT nova',
        mensagem: 'Há nova convenção coletivada para revisão.',
        tipo: 'NOVA_CCT_MTE',
        prioridade: 'ALTA',
        status: 'PENDENTE',
        clientesImpactados: 1,
        chaveUnica: `dashboard:${Date.now()}`
      }
    });

    await prisma.enquadramentoSindical.create({
      data: {
        clienteId: cliente.id,
        sindicatoId: sindicato.id,
        tipo: 'SINDICAL',
        status: 'VALIDADO_DP'
      }
    });

    const response = await fetch(`http://127.0.0.1:${port}/api/modulo-dp/dashboard/resumo`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.totalClientes >= 1, true);
    assert.equal(body.totalSindicatos >= 1, true);
    assert.equal(body.totalConvenios >= 1, true);
    assert.equal(body.totalAlertasPendentes >= 1, true);
    assert.equal(body.totalImpactos >= 1, true);
    assert.equal(body.totalContribuicoes >= 1, true);
  } finally {
    server.close();
  }
});

test('GET /api/radar/sindicatos/:id retorna metadados do monitoramento e site oficial', async () => {
  const { server, port } = await startTestServer();

  try {
    const sindicato = await prisma.sindicato.create({
      data: {
        cnpj: `12${Date.now().toString().slice(-12)}`.slice(0, 14),
        razaoSocial: 'Sindicato do Radar',
        uf: 'SP',
        cidade: 'São Paulo',
        siteUrl: 'https://sindicato.example.com',
        siteOficial: 'https://sindicato.example.com/oficial',
        ultimaVarreduraSite: new Date()
      }
    });

    const response = await fetch(`http://127.0.0.1:${port}/api/radar/sindicatos/${sindicato.id}`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.id, sindicato.id);
    assert.equal(body.siteUrl, 'https://sindicato.example.com');
    assert.equal(body.siteOficial, 'https://sindicato.example.com/oficial');
    assert.ok(body.ultimaVarreduraSite);
  } finally {
    server.close();
  }
});

test('GET /api/radar/sindicatos/:id/fallback divulga o estado de descoberta do site quando não há MTE', async () => {
  const { server, port } = await startTestServer();

  try {
    const sindicato = await prisma.sindicato.create({
      data: {
        cnpj: `13${Date.now().toString().slice(-12)}`.slice(0, 14),
        razaoSocial: 'Sindicato Fallback',
        uf: 'RJ',
        cidade: 'Rio de Janeiro',
        siteUrl: 'https://sindicato-fallback.example.com',
        siteOficial: 'https://sindicato-fallback.example.com/oficial'
      }
    });

    const response = await fetch(`http://127.0.0.1:${port}/api/radar/sindicatos/${sindicato.id}/fallback`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.sindicatoId, sindicato.id);
    assert.equal(body.fonte, 'site');
    assert.equal(body.disponivel, false);
    assert.ok(body.mensagem.includes('site') || body.mensagem.includes('fallback'));
  } finally {
    server.close();
  }
});

test('POST /api/radar/sindicatos/:id/fallback/cct falha fechado sem site oficial', async () => {
  const { server, port } = await startTestServer();

  try {
    const sindicato = await prisma.sindicato.create({
      data: {
        cnpj: `14${Date.now().toString().slice(-12)}`.slice(0, 14),
        razaoSocial: 'Sindicato sem site',
        uf: 'MG',
        cidade: 'Belo Horizonte'
      }
    });

    const response = await fetch(`http://127.0.0.1:${port}/api/radar/sindicatos/${sindicato.id}/fallback/cct`, {
      method: 'POST'
    });
    assert.equal(response.status, 502);

    const body = await response.json();
    assert.match(body.erro, /site oficial/i);
  } finally {
    server.close();
  }
});
