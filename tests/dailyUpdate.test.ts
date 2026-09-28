import test from 'node:test';
import assert from 'node:assert/strict';

import { descreverImpacto, startCronJobs } from '../src/jobs/dailyUpdate';
import { rotuloStatusEnquadramento } from '../src/services/enquadramentoStatus';

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
