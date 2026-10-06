import test from 'node:test';
import assert from 'node:assert/strict';

import { resetUnavailableAiProviders, runWithAiProviderFallback } from '../src/services/aiResilience';
import { avaliarEstadoRuntimeIa, verificarDisponibilidadeIa } from '../src/services/readiness';

test.beforeEach(() => {
  resetUnavailableAiProviders();
});

test('readiness usa apenas a probe do Gemini quando AI_PROVIDER=gemini', async () => {
  let chamadasAnthropic = 0;
  let chamadasGemini = 0;

  const resultado = await verificarDisponibilidadeIa('gemini', {
    anthropic: async () => {
      chamadasAnthropic += 1;
    },
    gemini: async () => {
      chamadasGemini += 1;
    }
  });

  assert.deepEqual(resultado, { ai: 'ok', gemini: 'ok' });
  assert.equal(chamadasAnthropic, 0);
  assert.equal(chamadasGemini, 1);
});

test('readiness propaga falha do provedor ativo sem consultar o outro', async () => {
  let chamadasAnthropic = 0;

  const resultado = await verificarDisponibilidadeIa('anthropic', {
    anthropic: async () => {
      chamadasAnthropic += 1;
      throw new Error('indisponivel');
    },
    gemini: async () => {
      throw new Error('nao deveria ser chamado');
    }
  });

  assert.equal(chamadasAnthropic, 1);
  assert.equal(resultado.ai, 'falha');
  assert.equal(resultado.anthropic, 'falha');
  assert.match(resultado.erro ?? '', /Anthropic: Error: indisponivel/);
});

test('readiness expõe failover degradado quando o fallback fica indisponível no processo', async () => {
  await assert.rejects(
    () => runWithAiProviderFallback({
      provider: 'gemini',
      operation: 'extracao-cct',
      delaysMs: [0],
      handlers: {
        gemini: async () => {
          throw {
            status: 404,
            message: 'models/gemini-2.5-flash is not found for API version v1beta'
          };
        },
        anthropic: async () => {
          throw {
            status: 400,
            message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'
          };
        }
      }
    })
  );

  const runtime = avaliarEstadoRuntimeIa({
    aiProvider: 'gemini',
    aiFallbackProvider: 'anthropic',
    aiFallbackConfigured: true
  });

  assert.equal(runtime.aiFallbackOperational, false);
  assert.match(runtime.aiFallbackUnavailableReason ?? '', /credit balance is too low/);
  assert.match(runtime.anthropicUnavailableReason ?? '', /credit balance is too low/);
});
