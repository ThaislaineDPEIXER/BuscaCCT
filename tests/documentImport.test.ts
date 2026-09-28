import assert from 'node:assert/strict';
import test from 'node:test';

import { EMPRESA_HEADERS, SINDICATO_HEADERS } from '../src/services/adminSheetParser';
import { mimeSuportado } from '../src/services/aiDocumentReader';
import { interpretarExtracao, montarLinhasImportacao } from '../src/services/documentImport';

const coluna = (header: typeof EMPRESA_HEADERS[number]) => EMPRESA_HEADERS.indexOf(header);

test('interpretarExtracao aceita JSON cercado por Markdown e rejeita formato inválido', () => {
  const extracao = interpretarExtracao('```json\n{"empresas":[{"cnpj":"12345678000195"}],"sindicatos":[]}\n```');
  assert.equal(extracao.empresas.length, 1);
  assert.throws(() => interpretarExtracao('não é JSON'), /JSON válido/);
  assert.throws(() => interpretarExtracao('{"empresas":[]}'), /formato esperado/);
});

test('montarLinhasImportacao valida, deduplica e nunca preenche vínculo sindical', () => {
  const linhas = montarLinhasImportacao({
    empresas: [
      { cnpj: '12.345.678/0001-95', razao_social: 'ACME LTDA', cnae_principal: '4711-3/02', uf: 'SC', municipio: 'Penha', cct_registro: 'SC000123/2026' },
      { cnpj: '12345678000195', razao_social: 'ACME repetida', cnae_principal: '4711302', uf: 'SC', municipio: 'Penha' },
      { cnpj: '98765432000100', razao_social: 'Já na planilha', cnae_principal: '4711302', uf: 'SC', municipio: 'Penha' },
      { cnpj: '123', razao_social: 'CNPJ inventado', cnae_principal: '4711302', uf: 'SC', municipio: 'Penha' }
    ],
    sindicatos: [
      { cnpj: '11.222.333/0001-81', nome: 'Sindicato do Comércio', uf: 'sc', base_territorial: ['Penha', 'Itajaí'] }
    ]
  }, { empresas: new Set(['98765432000100']), sindicatos: new Set() }, 'cartao.pdf');

  assert.equal(linhas.empresas.length, 1);
  assert.equal(linhas.duplicadas, 2);
  assert.equal(linhas.rejeitadas.length, 1);
  assert.match(linhas.rejeitadas[0], /cartao\.pdf: item 4 rejeitado/);

  const [empresa] = linhas.empresas;
  assert.equal(empresa.length, EMPRESA_HEADERS.length);
  assert.equal(empresa[coluna('CNPJ')], '12345678000195');
  assert.equal(empresa[coluna('CNAE Principal')], '4711302');
  assert.equal(empresa[coluna('CCT (Registro MTE)')], 'SC000123/2026');
  assert.equal(empresa[coluna('CNPJ Sindicato Laboral')], '');
  assert.equal(empresa[coluna('CNPJ Sindicato Patronal')], '');

  const [sindicato] = linhas.sindicatos;
  assert.equal(sindicato.length, SINDICATO_HEADERS.length);
  assert.deepEqual(sindicato.slice(0, 3), ['11222333000181', 'Sindicato do Comércio', 'SC']);
  assert.equal(sindicato[SINDICATO_HEADERS.indexOf('Base Territorial')], 'Penha, Itajaí');
});

test('mimeSuportado aceita PDF e imagens e recusa outros formatos', () => {
  assert.equal(mimeSuportado('application/pdf'), true);
  assert.equal(mimeSuportado('image/jpeg'), true);
  assert.equal(mimeSuportado('application/vnd.google-apps.document'), false);
  assert.equal(mimeSuportado(undefined), false);
});
