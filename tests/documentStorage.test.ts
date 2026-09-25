import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { storePdf } from '../src/services/documentStorage';

test('storePdf persiste os bytes e retorna hash SHA-256 estável', async () => {
  const diretorio = await fs.mkdtemp(path.join(os.tmpdir(), 'busca-cct-storage-'));
  const pdf = Buffer.from('%PDF-1.7\nconteudo de teste');
  const esperado = crypto.createHash('sha256').update(pdf).digest('hex');

  try {
    const primeiro = await storePdf(pdf, diretorio, `12345678000195-2026-${esperado}.pdf`);
    const segundo = await storePdf(pdf, diretorio, `12345678000195-2026-${esperado}.pdf`);
    const gravado = await fs.readFile(path.join(diretorio, primeiro.storagePath));

    assert.equal(primeiro.hashSha256, esperado);
    assert.deepEqual(gravado, pdf);
    assert.deepEqual(segundo, primeiro);
  } finally {
    await fs.rm(diretorio, { recursive: true, force: true });
  }
});
