import test from 'node:test';
import assert from 'node:assert/strict';

import { isTransientAiError, runWithAiProviderFallback } from '../src/services/aiResilience';

test('isTransientAiError identifica falhas transitórias por status e rede', () => {
  assert.equal(isTransientAiError({ status: 503 }), true);
  assert.equal(isTransientAiError({ statusCode: 429 }), true);
  assert.equal(isTransientAiError({ code: 'ETIMEDOUT' }), true);
  assert.equal(isTransientAiError({ message: 'socket timeout while calling provider' }), true);
  assert.equal(isTransientAiError({ status: 400 }), false);
  assert.equal(isTransientAiError(new Error('invalid prompt payload')), false);
});

test('runWithAiProviderFallback reaplica tentativas no provider primário até obter sucesso', async () => {
  let tentativas = 0;
  const resultado = await runWithAiProviderFallback({
    provider: 'gemini',
    operation: 'extracao-cct',
    delaysMs: [0, 0],
    handlers: {
      gemini: async () => {
        tentativas += 1;
        if (tentativas < 3) throw { status: 503, message: 'busy' };
        return 'ok';
      },
      anthropic: async () => 'fallback'
    }
  });

  assert.equal(resultado, 'ok');
  assert.equal(tentativas, 3);
});

test('runWithAiProviderFallback alterna para o provider secundário após esgotar retries transitórios', async () => {
  const chamadas: string[] = [];
  const resultado = await runWithAiProviderFallback({
    provider: 'gemini',
    operation: 'leitura-documento',
    delaysMs: [0],
    handlers: {
      gemini: async () => {
        chamadas.push('gemini');
        throw { status: 503, message: 'overloaded' };
      },
      anthropic: async () => {
        chamadas.push('anthropic');
        return 'ok-anthropic';
      }
    }
  });

  assert.equal(resultado, 'ok-anthropic');
  assert.deepEqual(chamadas, ['gemini', 'gemini', 'anthropic']);
});

test('runWithAiProviderFallback não faz fallback em erro não transitório', async () => {
  let fallbackChamado = false;

  await assert.rejects(
    () => runWithAiProviderFallback({
      provider: 'gemini',
      operation: 'radar-discovery',
      delaysMs: [0],
      handlers: {
        gemini: async () => {
          throw new Error('schema inválido');
        },
        anthropic: async () => {
          fallbackChamado = true;
          return 'nao-deveria';
        }
      }
    }),
    /schema inválido/
  );

  assert.equal(fallbackChamado, false);
});

test('runWithAiProviderFallback usa o secundário quando o primário está indisponível na configuração', async () => {
  const resultado = await runWithAiProviderFallback({
    provider: 'gemini',
    operation: 'analise-texto',
    delaysMs: [0],
    handlers: {
      anthropic: async () => 'ok-anthropic'
    }
  });

  assert.equal(resultado, 'ok-anthropic');
});
