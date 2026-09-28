import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import * as XLS from '@e965/xlsx';

import { EMPRESA_HEADERS, SINDICATO_HEADERS } from '../src/services/adminSheetParser';
import { mimeSuportado } from '../src/services/aiDocumentReader';
import { interpretarExtracao, montarLinhasImportacao, lerCadastroSindicalExcel } from '../src/services/documentImport';

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

test('lerCadastroSindicalExcel preserva linhas de cadastro e deduplica sem criar vinculos', () => {
  const workbook = XLS.utils.book_new();
  XLS.utils.book_append_sheet(workbook, XLS.utils.aoa_to_sheet([
    ['Relatório de entidades'],
    ['Razão Social', 'UF', 'CNPJ', 'Base Territorial', 'Status'],
    ['Sindicato do Comércio', 'SC', '11.222.333/0001-81', 'Penha, Itajaí', 'INATIVO'],
    ['Repetido', 'SC', '11.222.333/0001-81'],
    ['Sem CNPJ', 'SC', '']
  ]), 'Sindicatos');
  for (const [formato, extensao] of [['biff8', 'xls'], ['xlsx', 'xlsx']] as const) {
    const planilha = XLS.write(workbook, { bookType: formato, type: 'buffer' });
    const linhas = lerCadastroSindicalExcel(planilha, { empresas: new Set(), sindicatos: new Set() }, `sindicatos.${extensao}`);
    assert.deepEqual(linhas.empresas, []);
    assert.equal(linhas.sindicatos.length, 1);
    assert.equal(linhas.sindicatos[0][0], '11222333000181');
    assert.equal(linhas.sindicatos[0][SINDICATO_HEADERS.indexOf('Base Territorial')], 'Penha, Itajaí');
    assert.equal(linhas.sindicatos[0][SINDICATO_HEADERS.indexOf('Status de Monitorização')], 'INATIVO');
    assert.equal(linhas.duplicadas, 1);
    assert.match(linhas.rejeitadas[0], /item 5 rejeitado/);
  }
  assert.throws(() => lerCadastroSindicalExcel(Buffer.from('invalido'), { empresas: new Set(), sindicatos: new Set() }, 'outro.xls'), /nenhuma aba possui/);
});

test('lerCadastroSindicalExcel ignora aba anunciada sem conteúdo', () => {
  const workbook = XLS.utils.book_new();
  XLS.utils.book_append_sheet(workbook, XLS.utils.aoa_to_sheet([
    ['CNPJ', 'Nome do Sindicato', 'UF'],
    ['11.222.333/0001-81', 'Sindicato do Comércio', 'SC']
  ]), 'Cadastro');
  const arquivo = XLS.write(workbook, { bookType: 'biff8', type: 'buffer' });
  const lido = XLS.read(arquivo, { type: 'buffer' });
  const leitor = mock.method(require('@e965/xlsx'), 'read', () => ({
    ...lido,
    SheetNames: ['Auxiliar', ...lido.SheetNames]
  }));
  try {
    const linhas = lerCadastroSindicalExcel(arquivo, { empresas: new Set(), sindicatos: new Set() }, 'sindicatos.xls');
    assert.equal(linhas.sindicatos.length, 1);
  } finally {
    leitor.mock.restore();
  }

  const somenteAbaAusente = mock.method(require('@e965/xlsx'), 'read', () => ({
    SheetNames: ['Auxiliar'],
    Sheets: {}
  }));
  try {
    assert.throws(() => lerCadastroSindicalExcel(arquivo, { empresas: new Set(), sindicatos: new Set() }, 'sindicatos.xls'), /nenhuma aba possui as colunas/);
  } finally {
    somenteAbaAusente.mock.restore();
  }
});
