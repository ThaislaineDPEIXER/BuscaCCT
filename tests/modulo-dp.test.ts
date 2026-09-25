import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/server';
import { validarExtracaoCct } from '../src/services/claudeAgent';

async function request(path: string, method = 'GET', body?: unknown) {
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as { port: number };

  try {
    const payload = body ? JSON.stringify(body) : undefined;
    const response = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : undefined
      }, (res) => {
        let bodyText = '';
        res.on('data', (chunk) => {
          bodyText += chunk.toString();
        });
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: bodyText }));
      });

      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });

    return response;
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('GET /modulo-dp/alertas/sindicatos existe e responde 200', async () => {
  const response = await request('/modulo-dp/alertas/sindicatos');
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.ok(Array.isArray(payload));
});

test('POST /modulo-dp/consultar exige uma pergunta', async () => {
  const response = await request('/modulo-dp/consultar', 'POST', {});
  assert.equal(response.statusCode, 400);
});

test('POST /api/modulo-dp/consultar exige uma pergunta', async () => {
  const response = await request('/api/modulo-dp/consultar', 'POST', {});
  assert.equal(response.statusCode, 400);
});

test('validarExtracaoCct aceita o contrato estruturado e preserva nulos', () => {
  const extracao = validarExtracaoCct({
    sindicato_nome: 'Sindicato do Comercio',
    data_base_mes: null,
    vigencia_inicio: '01/01/2026',
    vigencia_fim: '31/12/2026',
    pisos_salariais: [{ cargo_ou_categoria: 'Geral', valor: 1950.5 }],
    horas_extras: [{ condicao: 'Domingos e Feriados', percentual: 100 }],
    beneficios: {
      vale_refeicao_diario: null,
      desconto_vale_refeicao_percentual: null,
      quebra_de_caixa_mensal: null,
      anuenio_percentual: null
    },
    resumo_mudancas: null
  });
  assert.equal(extracao.pisos_salariais[0].valor, 1950.5);
  assert.equal(extracao.beneficios.quebra_de_caixa_mensal, null);
});
