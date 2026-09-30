import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import * as XLS from '@e965/xlsx';

import { EMPRESA_HEADERS, SINDICATO_HEADERS } from '../src/services/adminSheetParser';
import { mimeSuportado } from '../src/services/aiDocumentReader';
import { identificarPdfCctManual, interpretarExtracao, montarLinhasImportacao, lerCadastroSindicalCsv, lerCadastroSindicalExcel, textoContemCnpj } from '../src/services/documentImport';

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

test('identificarPdfCctManual exige CNPJ e ano no nome do PDF', () => {
  assert.deepEqual(identificarPdfCctManual('CCT-79831442000130-2026.pdf'), {
    cnpjSindicato: '79831442000130',
    anoVigencia: 2026
  });
  assert.equal(identificarPdfCctManual('CCT-SINDPD-2026.pdf'), null);
  assert.equal(identificarPdfCctManual('CCT-79831442000130-1999.pdf'), null);
  assert.equal(identificarPdfCctManual('cartao-cnpj.pdf'), null);
});

test('textoContemCnpj exige que o CNPJ informado apareça no documento extraído', () => {
  assert.equal(textoContemCnpj('SINDICATO: 79.831.442/0001-30', '79831442000130'), true);
  assert.equal(textoContemCnpj('SINDICATO: 80.673.387/0001-86', '79831442000130'), false);
  assert.equal(textoContemCnpj('sem CNPJ', '79831442000130'), false);
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

test('lerCadastroSindicalExcel aceita cabeçalhos com pontuação e mostra os encontrados quando não reconhece', () => {
  const vazio = { empresas: new Set<string>(), sindicatos: new Set<string>() };
  const planilha = (linhas: string[][]) => {
    const workbook = XLS.utils.book_new();
    XLS.utils.book_append_sheet(workbook, XLS.utils.aoa_to_sheet(linhas), 'Relatório');
    return XLS.write(workbook, { bookType: 'biff8', type: 'buffer' });
  };

  const aceita = lerCadastroSindicalExcel(planilha([
    ['Sindicato', 'C.N.P.J.', 'U.F.'],
    ['Sindicato do Comércio', '11.222.333/0001-81', 'SC']
  ]), vazio, 'pontuado.xls');
  assert.equal(aceita.sindicatos.length, 1);
  assert.equal(aceita.sindicatos[0][1], 'Sindicato do Comércio');

  assert.throws(
    () => lerCadastroSindicalExcel(planilha([['Relação de sindicatos'], ['Código', 'Descrição', 'Inscrição'], ['62', 'SINCOMEC', '11222333000181']]), vazio, 'outro.xls'),
    /Cabeçalhos encontrados: aba "Relatório" linha 2: Código \| Descrição \| Inscrição/
  );
});

test('lerCadastroSindicalExcel importa relatório de ERP em blocos Código:/Nome:/CNPJ:', () => {
  const workbook = XLS.utils.book_new();
  XLS.utils.book_append_sheet(workbook, XLS.utils.aoa_to_sheet([
    ['RELATÓRIO CADASTRO DE SINDICATOS DOS EMPREGADOS', '', '', 'Página:', '1'],
    ['Código:', '62', 'Apelido:', 'SINCOMEC', 'Nome:', 'SINDICATO DOS EMPREGADOS DO COMERCIO DE RIO DO SUL'],
    ['CNPJ:', '85.787.562/0001-80', 'Tipo entidade:', '1 - Sindicato', 'Código entidade:', '000.004.162.97474-7'],
    ['Cidade:', 'RIO DO SUL', 'Santa Catarina', '89160-000'],
    ['Código:', '13', 'Apelido:', 'SINTRAVEST', 'Nome:', ''],
    ['CNPJ:', '79.370.763/0001-84'],
    ['Cidade:', 'JOINVILLE - SC'],
    ['Código:', '29', 'Apelido:', 'SEM ESTADO', 'Nome:', 'SINDICATO SEM UF'],
    ['CNPJ:', '84.437.367/0001-67'],
    ['Cidade:', '', 'Paraná']
  ]), 'Relatório');
  const arquivo = XLS.write(workbook, { bookType: 'biff8', type: 'buffer' });
  const coluna = (header: typeof SINDICATO_HEADERS[number]) => SINDICATO_HEADERS.indexOf(header);

  const linhas = lerCadastroSindicalExcel(arquivo, { empresas: new Set(), sindicatos: new Set() }, 'dominio.xls');
  assert.equal(linhas.sindicatos.length, 3);
  const [primeiro, segundo, terceiro] = linhas.sindicatos;
  assert.equal(primeiro[coluna('CNPJ')], '85787562000180');
  assert.equal(primeiro[coluna('Nome do Sindicato')], 'SINDICATO DOS EMPREGADOS DO COMERCIO DE RIO DO SUL');
  assert.equal(primeiro[coluna('Código Sindical')], '62');
  assert.equal(primeiro[coluna('UF')], 'SC');
  assert.equal(primeiro[coluna('Município')], 'RIO DO SUL');
  assert.equal(segundo[coluna('Nome do Sindicato')], 'SINTRAVEST');
  assert.deepEqual([segundo[coluna('UF')], segundo[coluna('Município')]], ['SC', 'JOINVILLE']);
  assert.deepEqual([terceiro[coluna('UF')], terceiro[coluna('Município')]], ['PR', '']);
});

test('lerCadastroSindicalCsv lê o relatório esparso em Windows-1252 e converte o estado', () => {
  const csv = [
    'RELATÓRIO CADASTRO DE SINDICATOS DOS EMPREGADOS,,,,,,,,,,,,Página:, ,1',
    'Código:,,,,2,,,,,,,,,,',
    'Apelido:,,,,,,,,,,,,,,',
    'Nome:,,,,SINDICATO DOS EMPREGADOS NA IND METALURGICA DE TIMBO,,,,,,,,,,',
    'CNPJ:,,,,,,,86.379.211/0001-00,,,,,,,',
    'Tipo entidade:,,,,,,,1 - Sindicato,,,,,,,',
    'Código entidade:,,,,,,,000.011.163.13074-0,,,,,,,',
    'Cidade:,,,,,,,TIMBÓ,,,,,,,',
    'Estado:,,,,,,,,Santa Catarina,,,,,,',
    'Código:,,,,1586,,,,,,,,,,',
    'Apelido:,,,,SINDPD,,,,,,,,,,',
    'Nome:,,,,SINDPD/SC - SIND DOS EMPREGADOS EM EMPRESAS DE PROCESSAMENTOS DE DADOS DE SC,,,,,,,,,,',
    'CNPJ:,,,,,,,79.831.442/0001-30,,,,,,,',
    'Cidade:,,,,,,,Florianópolis,,,,,,,',
    'Estado:,,,,,,,,Santa Catarina,,,,,,'
  ].join('\r\n');
  const linhas = lerCadastroSindicalCsv(Buffer.from(csv, 'latin1'), { empresas: new Set(), sindicatos: new Set() }, 'dominio.csv');
  const colunaSindicato = (header: typeof SINDICATO_HEADERS[number]) => SINDICATO_HEADERS.indexOf(header);

  assert.equal(linhas.sindicatos.length, 2);
  assert.equal(linhas.sindicatos[0][colunaSindicato('Código Sindical')], '2');
  assert.equal(linhas.sindicatos[0][colunaSindicato('Nome do Sindicato')], 'SINDICATO DOS EMPREGADOS NA IND METALURGICA DE TIMBO');
  assert.equal(linhas.sindicatos[0][colunaSindicato('CNPJ')], '86379211000100');
  assert.equal(linhas.sindicatos[0][colunaSindicato('UF')], 'SC');
  assert.equal(linhas.sindicatos[0][colunaSindicato('Município')], 'TIMBÓ');
  assert.equal(linhas.sindicatos[1][colunaSindicato('Código Sindical')], '1586');
  assert.equal(linhas.sindicatos[1][colunaSindicato('UF')], 'SC');
});

test('lerCadastroSindicalExcel rejeita bloco de relatório sem UF, sem inventar o estado', () => {
  const workbook = XLS.utils.book_new();
  XLS.utils.book_append_sheet(workbook, XLS.utils.aoa_to_sheet([
    ['Código:', '62', 'Nome:', 'SINDICATO A'], ['CNPJ:', '85.787.562/0001-80'], ['Cidade:', 'RIO DO SUL', 'Santa Catarina'],
    ['Código:', '7', 'Nome:', 'SINDICATO B'], ['CNPJ:', '79.370.763/0001-84'], ['Cidade:', 'JOINVILLE']
  ]), 'Relatório');
  const linhas = lerCadastroSindicalExcel(XLS.write(workbook, { bookType: 'biff8', type: 'buffer' }), { empresas: new Set(), sindicatos: new Set() }, 'dominio.xls');
  assert.equal(linhas.sindicatos.length, 1);
  assert.match(linhas.rejeitadas[0], /dominio\.xls: item 4 rejeitado \(UF inválida/);
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
    assert.throws(
      () => lerCadastroSindicalExcel(arquivo, { empresas: new Set(), sindicatos: new Set() }, 'sindicatos.xls'),
      /nenhuma aba possui as colunas.*Nenhuma aba legível \(formato desconhecido; assinatura [0-9a-f]+; abas listadas \[Auxiliar\]; abas lidas \[\]/
    );
  } finally {
    somenteAbaAusente.mock.restore();
  }

  const chaveDiferente = mock.method(require('@e965/xlsx'), 'read', () => ({
    SheetNames: ['Relatório'],
    Sheets: { 'Relat?rio': lido.Sheets[lido.SheetNames[0]] }
  }));
  try {
    const linhas = lerCadastroSindicalExcel(arquivo, { empresas: new Set(), sindicatos: new Set() }, 'sindicatos.xls');
    assert.equal(linhas.sindicatos.length, 1);
  } finally {
    chaveDiferente.mock.restore();
  }
});
