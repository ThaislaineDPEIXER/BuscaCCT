import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { prisma } from '../src/db';
import { normalizarCnpjSindicato, registrarSindicato, validarRegistroSindicato } from '../src/jobs/registerUnion';

test('normalizarCnpjSindicato aceita máscara e rejeita formatos inválidos', () => {
  assert.equal(normalizarCnpjSindicato('12.345.678/0001-95'), '12345678000195');
  assert.throws(() => normalizarCnpjSindicato('1234567800019'), /14 dígitos/);
  assert.throws(() => normalizarCnpjSindicato('12345678000195A'), /14 dígitos/);
});

test('validarRegistroSindicato exige CNPJ, nome e UF', () => {
  assert.throws(() => validarRegistroSindicato({ nome: 'X', uf: 'SC' }), /--cnpj/);
  assert.throws(() => validarRegistroSindicato({ cnpj: '12345678000195', uf: 'SC' }), /--nome/);
  assert.throws(() => validarRegistroSindicato({ cnpj: '12345678000195', nome: 'X', uf: 'Santa Catarina' }), /--uf/);
  assert.equal(validarRegistroSindicato({ cnpj: '12345678000195', nome: ' X ', uf: 'sc' }).uf, 'SC');
});

test('registrarSindicato cria e depois atualiza o mesmo CNPJ', async () => {
  const cnpj = `77${randomUUID().replace(/\D/g, '').padEnd(12, '0').slice(0, 12)}`;

  const criado = await registrarSindicato({ cnpj, nome: 'Sindicato Registro', uf: 'sc' });
  const atualizado = await registrarSindicato({ cnpj, nome: 'Sindicato Registro Atualizado', uf: 'PR', categoria: 'Comércio' });

  assert.equal(atualizado.id, criado.id);
  assert.equal(atualizado.razaoSocial, 'Sindicato Registro Atualizado');
  assert.equal(atualizado.uf, 'PR');
  assert.equal(atualizado.segmento, 'Comércio');
  assert.equal(atualizado.ativo, true);
  assert.equal(await prisma.sindicato.count({ where: { cnpj } }), 1);
});
