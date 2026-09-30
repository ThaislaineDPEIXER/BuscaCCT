import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { ExtracaoCct } from './claudeAgent';

function textoOuNull(valor: string | null): string | null {
  return valor?.trim() || null;
}

export async function persistirExtracaoCct(cnpjSindicato: string, anoVigencia: number, extracao: ExtracaoCct) {
  return prisma.$transaction(async tx => {
    const cct = await tx.convencaoColetiva.findUnique({
      where: { cnpjSindicato_anoVigencia: { cnpjSindicato, anoVigencia } },
      select: { id: true }
    });
    if (!cct) throw new Error('CCT não encontrada para persistir a extração.');

    await tx.impactoFolha.deleteMany({
      where: {
        convencaoColetivaId: cct.id,
        status: 'PENDENTE_VALIDACAO'
      }
    });
    await tx.contribuicaoSindical.deleteMany({
      where: {
        convencaoColetivaId: cct.id,
        status: 'NOVA'
      }
    });

    for (const impacto of extracao.impactos_folha) {
      await tx.impactoFolha.create({
        data: {
          convencaoColetivaId: cct.id,
          categoria: impacto.categoria,
          descricao: impacto.descricao,
          valorAnterior: impacto.valor_anterior,
          valorNovo: impacto.valor_novo,
          percentual: impacto.percentual,
          vigencia: textoOuNull(impacto.vigencia),
          evidencia: textoOuNull(impacto.evidencia),
          status: 'PENDENTE_VALIDACAO'
        }
      });
    }

    for (const contribuicao of extracao.contribuicoes_sindicais) {
      await tx.contribuicaoSindical.create({
        data: {
          convencaoColetivaId: cct.id,
          tipo: contribuicao.tipo,
          valorTexto: textoOuNull(contribuicao.valor_texto),
          valorNumerico: contribuicao.valor_numerico,
          percentual: contribuicao.percentual,
          vencimento: textoOuNull(contribuicao.vencimento),
          obrigatoriedade: textoOuNull(contribuicao.obrigatoriedade),
          dadosPagamento: textoOuNull(contribuicao.dados_pagamento),
          evidencia: textoOuNull(contribuicao.evidencia),
          status: 'NOVA'
        }
      });
    }

    return tx.convencaoColetiva.update({
      where: { id: cct.id },
      data: {
        status: 'EXTRAIDA',
        parametrosJson: JSON.stringify(extracao),
        resumoCct: extracao.resumo_mudancas
      },
      include: {
        impactosFolha: true,
        contribuicoes: true
      }
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
