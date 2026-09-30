import test from 'node:test';
import assert from 'node:assert/strict';

import { SHEET_LAYOUT } from '../src/services/googleWorkspace';
import { cctsQueBloqueiamFila, descreverImpacto, filtroElegibilidadeFilaMte, montarLinhaPainel, startCronJobs } from '../src/jobs/dailyUpdate';
import { rotuloStatusEnquadramento } from '../src/services/enquadramentoStatus';

test('montarLinhaPainel separa código, nome e CNPJ do sindicato na ordem do cabeçalho', () => {
  const data = new Date('2026-09-29T06:00:00.000Z');
  const empresas = [
    { razaoSocial: 'ACME LTDA', codigoErp: '1586/5', cctRegistro: 'SC000123/2026' },
    { razaoSocial: 'BETA SA', codigoErp: null, cctRegistro: 'SC000123/2026' }
  ];
  const linha = montarLinhaPainel(data, { cnpj: '85787562000180', razaoSocial: 'SINCOMEC', codigoSindical: ' 62 ' }, empresas, 'Sem alteração', 'https://drive/x');
  assert.equal(linha.length, SHEET_LAYOUT.painel.headers.length);
  assert.deepEqual(linha, [
    '2026-09-29T06:00:00.000Z', '62', '-', 'SINCOMEC', '85.787.562/0001-80',
    'ACME LTDA (Cód: 1586/5); BETA SA (Cód: -)', 'SC000123/2026', 'Sem alteração', 'https://drive/x'
  ]);
  const semDados = montarLinhaPainel(data, { cnpj: '1', razaoSocial: 'X', codigoSindical: null }, [], '', '');
  assert.equal(semDados[SHEET_LAYOUT.painel.headers.indexOf('Código Sindicato')], '-');
  assert.equal(semDados[SHEET_LAYOUT.painel.headers.indexOf('Código Convenção (ERP)')], '-');
  assert.equal(semDados[SHEET_LAYOUT.painel.headers.indexOf('CCT (Registro MTE)')], '-');
});

test('descreverImpacto gera o texto que aciona as cores do painel', () => {
  assert.match(descreverImpacto(2, 'Piso reajustado.'), /^Alerta: 2 impacto\(s\) na folha — Piso reajustado\.$/);
  assert.equal(descreverImpacto(0, null), 'Sem alteração');
});

test('retry da fila MTE libera apenas pendências de download manual', () => {
  const cacheCctDesde = new Date('2026-09-29T00:00:00.000Z');
  assert.deepEqual(cctsQueBloqueiamFila(cacheCctDesde, false).map(filtro => filtro.status), [
    'PENDENTE_DOWNLOAD_MANUAL', 'EXTRAIDA', 'EXTRAIDA'
  ]);
  assert.deepEqual(cctsQueBloqueiamFila(cacheCctDesde, true).map(filtro => filtro.status), ['EXTRAIDA', 'EXTRAIDA']);
});

test('retry da fila MTE prioriza pendências manuais mesmo com backoff ou varredura recente', () => {
  const agora = new Date('2026-09-30T00:00:00.000Z');
  const elegibilidade = filtroElegibilidadeFilaMte(agora, new Date('2026-09-29T00:00:00.000Z'), 2026, 9, true);
  assert.ok(Array.isArray(elegibilidade.OR));
  assert.deepEqual(elegibilidade.OR[1], {
    convencoes: { some: { anoVigencia: 2026, status: 'PENDENTE_DOWNLOAD_MANUAL' } }
  });
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
