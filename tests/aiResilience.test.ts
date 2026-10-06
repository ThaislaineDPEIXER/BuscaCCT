import test from 'node:test';
import assert from 'node:assert/strict';

import { getUnavailableAiProviderReason, isTransientAiError, resetUnavailableAiProviders, runWithAiProviderFallback } from '../src/services/aiResilience';

test.beforeEach(() => {
  resetUnavailableAiProviders();
});

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

test('runWithAiProviderFallback desativa o Gemini no restante da execução quando a quota diária esgota', async () => {
  const chamadas: string[] = [];

  const primeiroResultado = await runWithAiProviderFallback({
    provider: 'gemini',
    operation: 'extracao-cct',
    delaysMs: [0, 0],
    handlers: {
      gemini: async () => {
        chamadas.push('gemini-1');
        throw {
          status: 429,
          message: 'Quota exceeded for metric generate_content_free_tier_requests. Please retry in 7h.',
          errorDetails: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure' }]
        };
      },
      anthropic: async () => {
        chamadas.push('anthropic-1');
        return 'ok-anthropic-1';
      }
    }
  });

  const segundoResultado = await runWithAiProviderFallback({
    provider: 'gemini',
    operation: 'leitura-documento',
    delaysMs: [0],
    handlers: {
      gemini: async () => {
        chamadas.push('gemini-2');
        return 'nao-deveria-executar';
      },
      anthropic: async () => {
        chamadas.push('anthropic-2');
        return 'ok-anthropic-2';
      }
    }
  });

  assert.equal(primeiroResultado, 'ok-anthropic-1');
  assert.equal(segundoResultado, 'ok-anthropic-2');
  assert.match(getUnavailableAiProviderReason('gemini') ?? '', /Quota exceeded/);
  assert.deepEqual(chamadas, ['gemini-1', 'anthropic-1', 'anthropic-2']);
});

test('runWithAiProviderFallback alterna imediatamente quando o modelo do Gemini não é suportado', async () => {
  const chamadas: string[] = [];

  const resultado = await runWithAiProviderFallback({
    provider: 'gemini',
    operation: 'extracao-cct',
    delaysMs: [0, 0],
    handlers: {
      gemini: async () => {
        chamadas.push('gemini');
        throw {
          status: 404,
          message: 'models/gemini-1.5-flash is not found for API version v1beta, or is not supported for generateContent'
        };
      },
      anthropic: async () => {
        chamadas.push('anthropic');
        return 'ok-anthropic';
      }
    }
  });

  assert.equal(resultado, 'ok-anthropic');
  assert.deepEqual(chamadas, ['gemini', 'anthropic']);
});

test('runWithAiProviderFallback explica quando erro transitório ocorre sem fallback configurado', async () => {
  await assert.rejects(
    () => runWithAiProviderFallback({
      provider: 'gemini',
      operation: 'extracao-cct',
      delaysMs: [0],
      handlers: {
        gemini: async () => {
          throw { status: 503, message: 'overloaded' };
        }
      }
    }),
    /failover para anthropic não está configurado/
  );
});

test('runWithAiProviderFallback deixa de insistir no Anthropic quando a conta fica sem créditos', async () => {
  const chamadas: string[] = [];

  await assert.rejects(
    () => runWithAiProviderFallback({
      provider: 'gemini',
      operation: 'extracao-cct',
      delaysMs: [0],
      handlers: {
        gemini: async () => {
          chamadas.push('gemini-1');
          throw {
            status: 404,
            message: 'models/gemini-2.5-flash is not found for API version v1beta'
          };
        },
        anthropic: async () => {
          chamadas.push('anthropic-1');
          throw {
            status: 400,
            message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'
          };
        }
      }
    }),
    error => {
      assert.equal(typeof error, 'object');
      assert.match(String((error as { message?: string }).message ?? ''), /credit balance is too low/);
      return true;
    }
  );

  await assert.rejects(
    () => runWithAiProviderFallback({
      provider: 'gemini',
      operation: 'leitura-documento',
      delaysMs: [0],
      handlers: {
        gemini: async () => {
          chamadas.push('gemini-2');
          throw {
            status: 404,
            message: 'models/gemini-2.5-flash is not found for API version v1beta'
          };
        },
        anthropic: async () => {
          chamadas.push('anthropic-2');
          return 'nao-deveria-executar';
        }
      }
    }),
    /failover para anthropic está indisponível/
  );

  assert.deepEqual(chamadas, ['gemini-1', 'anthropic-1', 'gemini-2']);
});
