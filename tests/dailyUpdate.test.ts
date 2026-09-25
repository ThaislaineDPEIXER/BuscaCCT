import test from 'node:test';
import assert from 'node:assert/strict';

import { startCronJobs } from '../src/jobs/dailyUpdate';

test('startCronJobs deve registrar os jobs sem lançar erro', () => {
  let tarefas: ReturnType<typeof startCronJobs> = [];
  try {
    assert.doesNotThrow(() => { tarefas = startCronJobs(); });
    assert.equal(tarefas.length, 4);
  } finally {
    for (const tarefa of tarefas) tarefa.stop();
  }
});
