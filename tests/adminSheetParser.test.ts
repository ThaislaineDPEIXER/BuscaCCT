import test from 'node:test';
import assert from 'node:assert/strict';

import { EMPRESA_HEADERS, SINDICATO_HEADERS, completarCabecalho, sanitizarEmpresas, sanitizarSindicatos } from '../src/services/adminSheetParser';

test('completarCabecalho preenche integralmente uma planilha vazia', () => {
  assert.deepEqual(completarCabecalho([], EMPRESA_HEADERS), [...EMPRESA_HEADERS]);
  assert.deepEqual(completarCabecalho(['', '  '], SINDICATO_HEADERS), [...SINDICATO_HEADERS]);
});

test('sanitizarEmpresas normaliza campos opcionais e mantém linha rejeitada isolada', () => {
  const { registros, rejeitadas } = sanitizarEmpresas([
    [...EMPRESA_HEADERS],
    ['7001', '12.345.678/0001-95', 'Empresa Opcional', '6201501', 'Tecnologia', 'sc', 'Blumenau', '1586/5', 'sc000777/2026', '11.222.333/0001-81', '22.333.444/0001-82'],
    ['7002', '12.345.678/0001', 'Empresa Inválida', '6201501', 'Tecnologia', 'SC', 'Blumenau', '', '', '', '']
  ]);

  assert.equal(registros.length, 1);
  assert.equal(registros[0].codigoErp, '7001');
  assert.equal(registros[0].uf, 'SC');
  assert.equal(registros[0].cctRegistro, 'SC000777/2026');
  assert.equal(registros[0].cnpjSindicatoLaboral, '11222333000181');
  assert.equal(registros[0].cnpjSindicatoPatronal, '22333444000182');
  assert.deepEqual(rejeitadas.map(item => item.linha), [3]);
});

test('sanitizarSindicatos expande base territorial e normaliza código sindical opcional', () => {
  const { registros, rejeitadas } = sanitizarSindicatos([
    [...SINDICATO_HEADERS],
    ['11.222.333/0001-81', 'Sindicato Base', 'sc', 'Itajaí', 'Comércio', ' 62 ', 'Itajaí; Navegantes\nPenha', 'Ativo']
  ]);

  assert.equal(rejeitadas.length, 0);
  assert.equal(registros.length, 1);
  assert.equal(registros[0].uf, 'SC');
  assert.equal(registros[0].codigoSindical, '62');
  assert.deepEqual(registros[0].baseTerritorial, ['Itajaí', 'Navegantes', 'Penha']);
  assert.equal(registros[0].ativo, true);
});
