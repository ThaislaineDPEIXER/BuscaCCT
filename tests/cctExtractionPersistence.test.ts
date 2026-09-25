import assert from 'node:assert/strict';
import test from 'node:test';

import { prisma } from '../src/db';
import { persistirExtracaoCct } from '../src/services/cctExtractionPersistence';
import type { ExtracaoCct } from '../src/services/claudeAgent';

test('persistirExtracaoCct grava impactos e contribuições na CCT correta', async () => {
  const cnpjSindicato = `77${Date.now().toString().slice(-12)}`.slice(0, 14);
  const sindicato = await prisma.sindicato.create({
    data: {
      cnpj: cnpjSindicato,
      razaoSocial: 'Sindicato de Persistência',
      uf: 'SP',
      cidade: 'São Paulo'
    }
  });
  const cct = await prisma.convencaoColetiva.create({
    data: {
      cnpjSindicato: sindicato.cnpj,
      anoVigencia: 2026,
      textoCompleto: 'Documento de teste',
      fonteTipo: 'MTE'
    }
  });
  const extracao: ExtracaoCct = {
    sindicato_nome: sindicato.razaoSocial,
    data_base_mes: 'janeiro',
    vigencia_inicio: '01/01/2026',
    vigencia_fim: '31/12/2026',
    pisos_salariais: [],
    horas_extras: [],
    beneficios: {
      vale_refeicao_diario: null,
      desconto_vale_refeicao_percentual: null,
      quebra_de_caixa_mensal: null,
      anuenio_percentual: null
    },
    impactos_folha: [{
      categoria: 'PISO_SALARIAL',
      descricao: 'Piso geral',
      valor_anterior: null,
      valor_novo: 1950,
      percentual: null,
      vigencia: '01/01/2026',
      evidencia: 'Cláusula 3ª: piso de R$ 1.950,00.'
    }],
    contribuicoes_sindicais: [{
      tipo: 'ASSISTENCIAL',
      valor_texto: '1% do salário',
      valor_numerico: null,
      percentual: 1,
      vencimento: 'quinto dia útil',
      obrigatoriedade: 'conforme cláusula',
      dados_pagamento: null,
      evidencia: 'Cláusula 20ª: contribuição de 1%.'
    }],
    resumo_mudancas: 'Piso atualizado.'
  };

  const resultado = await persistirExtracaoCct(sindicato.cnpj, cct.anoVigencia, extracao);
  assert.equal(resultado.parametrosJson, JSON.stringify(extracao));
  assert.equal(resultado.impactosFolha.length, 1);
  assert.equal(resultado.impactosFolha[0].valorNovo, 1950);
  assert.equal(resultado.contribuicoes.length, 1);
  assert.equal(resultado.contribuicoes[0].percentual, 1);
});
