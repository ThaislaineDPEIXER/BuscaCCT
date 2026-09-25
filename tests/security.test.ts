import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

import { requirePortalApiKey } from '../src/middleware/security';

test('requirePortalApiKey rejeita ausência e aceita Bearer válido', async () => {
  const app = express();
  app.get('/protegido', requirePortalApiKey('segredo'), (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Servidor de teste sem porta');
  const url = `http://127.0.0.1:${address.port}/protegido`;

  try {
    const semChave = await fetch(url);
    assert.equal(semChave.status, 401);
    const comChave = await fetch(url, { headers: { Authorization: 'Bearer segredo' } });
    assert.equal(comChave.status, 200);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
