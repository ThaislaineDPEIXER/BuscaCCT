import test from 'node:test';
import assert from 'node:assert/strict';

import { validarExtracaoCct } from '../src/services/claudeAgent';

test('validarExtracaoCct aceita o contrato estruturado e preserva campos nulos', () => {
  const resultado = validarExtracaoCct({
    sindicato_nome: 'Sindicato do Comércio',
    data_base_mes: null,
    vigencia_inicio: '01/01/2026',
    vigencia_fim: '31/12/2026',
    pisos_salariais: [{ cargo_ou_categoria: 'Geral', valor: 1950.5 }],
    horas_extras: [{ condicao: 'Domingos e Feriados', percentual: 100 }],
    beneficios: {
      vale_refeicao_diario: 35,
      desconto_vale_refeicao_percentual: 20,
      quebra_de_caixa_mensal: null,
      anuenio_percentual: null
    },
    resumo_mudancas: null
  });

  assert.equal(resultado.pisos_salariais[0].valor, 1950.5);
  assert.equal(resultado.beneficios.quebra_de_caixa_mensal, null);
  assert.equal(resultado.resumo_mudancas, null);
});
