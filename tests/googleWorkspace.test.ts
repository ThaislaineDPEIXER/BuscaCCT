import assert from 'node:assert/strict';
import test from 'node:test';

import { dashboardNeedsHeaders, hasConditionalRule } from '../src/services/googleWorkspace';

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