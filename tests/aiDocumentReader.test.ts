import test from 'node:test';
import assert from 'node:assert/strict';

import { executarLeituraComIaPorProvider, mimeSuportado, type LeituraDocumentoIa } from '../src/services/aiDocumentReader';

const leitura: LeituraDocumentoIa = {
  systemPrompt: 'Extraia os dados.',
  instrucao: 'Leia o documento.',
  json: false,
  maxTokens: 256
};

test('executarLeituraComIaPorProvider direciona para Gemini quando configurado', async () => {
  const chamadas: string[] = [];
  const resultado = await executarLeituraComIaPorProvider('gemini', Buffer.from('pdf'), 'application/pdf', leitura, {
    gemini: async () => {
      chamadas.push('gemini');
      return 'ok-gemini';
    },
    anthropic: async () => {
      chamadas.push('anthropic');
      return 'ok-anthropic';
    }
  });

  assert.equal(resultado, 'ok-gemini');
  assert.deepEqual(chamadas, ['gemini']);
});

test('executarLeituraComIaPorProvider direciona para Anthropic quando configurado', async () => {
  const chamadas: string[] = [];
  const resultado = await executarLeituraComIaPorProvider('anthropic', Buffer.from('img'), 'image/png', leitura, {
    gemini: async () => {
      chamadas.push('gemini');
      return 'ok-gemini';
    },
    anthropic: async () => {
      chamadas.push('anthropic');
      return 'ok-anthropic';
    }
  });

  assert.equal(resultado, 'ok-anthropic');
  assert.deepEqual(chamadas, ['anthropic']);
});

test('executarLeituraComIaPorProvider rejeita documento vazio antes de chamar IA', async () => {
  await assert.rejects(
    () => executarLeituraComIaPorProvider('gemini', Buffer.alloc(0), 'application/pdf', leitura, {
      gemini: async () => 'nao-deveria',
      anthropic: async () => 'nao-deveria'
    }),
    /Documento vazio/
  );
});

test('mimeSuportado aceita somente os formatos previstos', () => {
  assert.equal(mimeSuportado('application/pdf'), true);
  assert.equal(mimeSuportado('image/webp'), true);
  assert.equal(mimeSuportado('text/plain'), false);
  assert.equal(mimeSuportado(undefined), false);
});
