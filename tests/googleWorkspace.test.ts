import assert from 'node:assert/strict';
import test from 'node:test';
import { mock } from 'node:test';
import * as googleDrive from '@googleapis/drive';

import { alinharAoCabecalho } from '../src/services/adminSheetParser';
import {
  SHEET_LAYOUT,
  cabecalhoDoPainel,
  dashboardNeedsHeaders,
  hasConditionalRule,
  isSummaryRule,
  listarDocumentosPendentes
} from '../src/services/googleWorkspace';

test('dashboardNeedsHeaders só inicializa quando o cabeçalho estiver vazio', () => {
  assert.equal(dashboardNeedsHeaders(undefined), true);
  assert.equal(dashboardNeedsHeaders([['', ' ', '', '']]), true);
  assert.equal(dashboardNeedsHeaders([['Data', 'Sindicato', 'Link do Drive', 'Resumo da IA']]), false);
});

test('hasConditionalRule reconhece regras existentes da coluna de resumo', () => {
  const regra = {
    ranges: [{ startColumnIndex: 3, endColumnIndex: 4 }],
    booleanRule: {
      condition: {
        type: 'CUSTOM_FORMULA',
        values: [{ userEnteredValue: '=REGEXMATCH($D2,"Aumento")' }]
      }
    }
  };

  assert.equal(hasConditionalRule(regra, 'Aumento', 3), true);
  assert.equal(hasConditionalRule(regra, 'Sem alteração', 3), false);
  assert.equal(hasConditionalRule(regra, 'Aumento', 5), false);
});

const PAINEL = SHEET_LAYOUT.painel.headers;
const ANTIGO = ['Data', 'Empresa Vinculada', 'Sindicato Laboral', 'Resumo/Impacto', 'Link PDF'];

test('cabecalhoDoPainel troca o layout só enquanto o painel não tem dados', () => {
  assert.deepEqual(cabecalhoDoPainel([], false, PAINEL), [...PAINEL]);
  assert.deepEqual(cabecalhoDoPainel(ANTIGO, false, PAINEL), [...PAINEL]);
  assert.equal(cabecalhoDoPainel([...PAINEL, ''], false, PAINEL), null);
  assert.deepEqual(
    cabecalhoDoPainel(ANTIGO, true, PAINEL),
    [...ANTIGO, 'Código Sindicato', 'Código Convenção (ERP)', 'Nome do Sindicato', 'CNPJ Sindicato', 'CCT (Registro MTE)', 'Link Drive']
  );
  assert.equal(cabecalhoDoPainel([...PAINEL], true, PAINEL), null);
});

test('linha do painel cai na coluna certa no layout novo e no antigo com colunas acrescentadas', () => {
  const linha = ['2026-09-29', '62', '-', 'SINCOMEC', '11222333000181', 'ACME (Cód: 1)', 'SC000123/2026', 'Sem alteração', 'https://drive/x'];
  assert.deepEqual(alinharAoCabecalho([linha], PAINEL, [...PAINEL])[0], linha);
  const legado = cabecalhoDoPainel(ANTIGO, true, PAINEL) ?? [];
  const [alinhada] = alinharAoCabecalho([linha], PAINEL, legado);
  assert.equal(alinhada[legado.indexOf('Resumo/Impacto')], 'Sem alteração');
  assert.equal(alinhada[legado.indexOf('CNPJ Sindicato')], '11222333000181');
  assert.equal(alinhada[legado.indexOf('Código Convenção (ERP)')], '-');
  assert.equal(alinhada[legado.indexOf('Sindicato Laboral')], '');
});

test('isSummaryRule reconhece apenas as regras de cor criadas pelo robô', () => {
  const formula = (valor: string) => ({ booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: valor }] } } });
  assert.equal(isSummaryRule(formula('=OR(REGEXMATCH($D2,"Aumento"),REGEXMATCH($D2,"Alerta"))')), true);
  assert.equal(isSummaryRule(formula('=REGEXMATCH($F2,"Alerta")')), true);
  assert.equal(isSummaryRule({ booleanRule: { condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'Sem alteração' }] } } }), true);
  assert.equal(isSummaryRule(formula('=$B2>10')), false);
  assert.equal(isSummaryRule({ booleanRule: { condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'Urgente' }] } } }), false);
});

test('listarDocumentosPendentes inclui arquivos da pasta principal e da subpasta sindical', async () => {
  const consultas: string[] = [];
  const drive = mock.method(googleDrive, 'drive', () => ({
    files: {
      list: async ({ q }: { q: string }) => {
        consultas.push(q);
        if (q.includes("name = 'Cadastros de Sindicatos'")) return { data: { files: [{ id: 'subpasta' }] } };
        if (q.includes("'entrada' in parents")) return { data: { files: [{ id: 'pdf', name: 'cartao.pdf', mimeType: 'application/pdf', size: '100' }] } };
        return { data: { files: [{ id: 'xls', name: 'sindicatos.xls', mimeType: 'application/vnd.ms-excel', size: '2048' }] } };
      }
    }
  }) as never);
  try {
    const documentos = await listarDocumentosPendentes('entrada');
    assert.deepEqual(documentos.map(item => item.nome), ['cartao.pdf', 'sindicatos.xls']);
    assert.ok(consultas.some(q => q.includes("'subpasta' in parents")));
  } finally {
    drive.mock.restore();
  }
});

test('reprocessamento manual inclui apenas planilhas sindicais com erro', async () => {
  const consultas: string[] = [];
  const drive = mock.method(googleDrive, 'drive', () => ({
    files: {
      list: async ({ q }: { q: string }) => {
        consultas.push(q);
        if (q.includes("name = 'Cadastros de Sindicatos'")) return { data: { files: [{ id: 'subpasta' }] } };
        if (q.includes("'entrada' in parents")) return { data: { files: [] } };
        return { data: { files: [
          { id: 'xls', name: 'sindicatos.xls', mimeType: 'application/vnd.ms-excel', appProperties: { radarImportacao: 'erro' } },
          { id: 'csv', name: 'sindicatos.csv', mimeType: 'text/csv', appProperties: { radarImportacao: 'erro' } },
          { id: 'pdf', name: 'cartao.pdf', mimeType: 'application/pdf', appProperties: { radarImportacao: 'erro' } }
        ] } };
      }
    }
  }) as never);
  try {
    const documentos = await listarDocumentosPendentes('entrada', true);
    assert.deepEqual(documentos.map(item => item.nome), ['sindicatos.xls', 'sindicatos.csv']);
    assert.ok(consultas.some(q => q.includes("'subpasta' in parents") && !q.includes("value='erro'")));
    assert.ok(consultas.some(q => q.includes("'entrada' in parents") && q.includes("value='erro'")));
  } finally {
    drive.mock.restore();
  }
});