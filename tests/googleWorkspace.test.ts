import assert from 'node:assert/strict';
import test from 'node:test';
import { mock } from 'node:test';
import * as googleDrive from '@googleapis/drive';

import { dashboardNeedsHeaders, hasConditionalRule, listarDocumentosPendentes } from '../src/services/googleWorkspace';

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

  assert.equal(hasConditionalRule(regra, 'Aumento'), true);
  assert.equal(hasConditionalRule(regra, 'Sem alteração'), false);
  assert.equal(hasConditionalRule({ ...regra, ranges: [{ startColumnIndex: 2, endColumnIndex: 3 }] }, 'Aumento'), false);
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