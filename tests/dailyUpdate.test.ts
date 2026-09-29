import test from 'node:test';
import assert from 'node:assert/strict';

import { SHEET_LAYOUT } from '../src/services/googleWorkspace';
import { descreverImpacto, montarLinhaPainel, startCronJobs } from '../src/jobs/dailyUpdate';
import { rotuloStatusEnquadramento } from '../src/services/enquadramentoStatus';

test('montarLinhaPainel separa código, nome e CNPJ do sindicato na ordem do cabeçalho', () => {
  const data = new Date('2026-09-29T06:00:00.000Z');
  const empresas = [{ razaoSocial: 'ACME LTDA', cnpj: '12345678000195' }, { razaoSocial: 'BETA SA', cnpj: '98765432000100' }];
  const linha = montarLinhaPainel(data, { cnpj: '11222333000181', razaoSocial: 'SINCOMEC', codigoSindical: ' 62 ' }, empresas, 'Sem alteração', 'https://drive/x');
  assert.equal(linha.length, SHEET_LAYOUT.painel.headers.length);
  assert.deepEqual(linha, [
    '2026-09-29T06:00:00.000Z', '62', 'SINCOMEC', '11222333000181',
    'ACME LTDA (12345678000195); BETA SA (98765432000100)', 'Sem alteração', 'https://drive/x'
  ]);
  assert.equal(montarLinhaPainel(data, { cnpj: '1', razaoSocial: 'X', codigoSindical: null }, [], '', '')[1], '-');
});

test('descreverImpacto gera o texto que aciona as cores do painel', () => {
  assert.match(descreverImpacto(2, 'Piso reajustado.'), /^Alerta: 2 impacto\(s\) na folha — Piso reajustado\.$/);
  assert.equal(descreverImpacto(0, null), 'Sem alteração');
});

test('rotuloStatusEnquadramento traduz os status gravados', () => {
  assert.equal(rotuloStatusEnquadramento('VALIDADO_DP'), 'CONFIRMADO');
  assert.equal(rotuloStatusEnquadramento('SUGERIDO_IA'), 'PENDENTE');
  assert.equal(rotuloStatusEnquadramento('REJEITADO'), 'REJEITADO');
});

test('startCronJobs deve registrar os jobs sem lançar erro', () => {
  let tarefas: ReturnType<typeof startCronJobs> = [];
  try {
    assert.doesNotThrow(() => { tarefas = startCronJobs(); });
    assert.equal(tarefas.length, 4);
  } finally {
    for (const tarefa of tarefas) tarefa.stop();
  }
});
