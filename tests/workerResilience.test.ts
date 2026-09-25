import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { calcularProximaTentativa } from '../src/jobs/dailyUpdate';
import { adquirirWorkerLock } from '../src/services/workerLock';

test('calcularProximaTentativa aplica backoff exponencial com teto', () => {
  const agora = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(calcularProximaTentativa(1, agora).getTime(), new Date('2026-01-01T00:15:00.000Z').getTime());
  assert.equal(calcularProximaTentativa(2, agora).getTime(), new Date('2026-01-01T00:30:00.000Z').getTime());
  assert.equal(calcularProximaTentativa(10, agora).getTime(), new Date('2026-01-01T06:00:00.000Z').getTime());
});

test('adquirirWorkerLock impede dois owners no mesmo CNPJ', async () => {
  const chave = `teste:${crypto.randomUUID()}`;
  const primeiro = await adquirirWorkerLock(chave, 'worker-1', 60_000);
  assert.ok(primeiro);

  try {
    const segundoBloqueado = await adquirirWorkerLock(chave, 'worker-2', 60_000);
    assert.equal(segundoBloqueado, null);
  } finally {
    await primeiro?.();
  }

  const segundo = await adquirirWorkerLock(chave, 'worker-2', 60_000);
  assert.ok(segundo);
  await segundo?.();
});
