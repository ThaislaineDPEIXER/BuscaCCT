import test from 'node:test';
import assert from 'node:assert/strict';

import { verificarDisponibilidadeIa } from '../src/services/readiness';

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
