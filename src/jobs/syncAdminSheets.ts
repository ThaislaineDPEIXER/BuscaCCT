import { env } from '../config/env';
import { prisma } from '../db';
import type { EmpresaPlanilha, LinhaRejeitada } from '../services/adminSheetParser';
import { STATUS_ENQUADRAMENTO } from '../services/enquadramentoStatus';
import { readAdminSheetData, type AdminSheetData } from '../services/googleWorkspace';

export type ResumoSincronizacao = {
  sindicatos: number;
  empresas: number;
  vinculosConfirmados: number;
  vinculosPreservados: number;
  rejeitadas: LinhaRejeitada[];
};

const ABA_EMPRESAS = 'Cadastro de Empresas';
const ABA_SINDICATOS = 'Cadastro de Sindicatos';

function motivo(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function vincular(
  empresa: EmpresaPlanilha,
  clienteId: string,
  cnpjSindicato: string,
  tipo: 'LABORAL' | 'PATRONAL',
  resumo: ResumoSincronizacao
): Promise<void> {
  const sindicato = await prisma.sindicato.findUnique({ where: { cnpj: cnpjSindicato }, select: { id: true } });
  if (!sindicato) {
    resumo.rejeitadas.push({
      aba: ABA_EMPRESAS,
      linha: empresa.linha,
      motivo: `Sindicato ${tipo.toLowerCase()} ${cnpjSindicato} não está cadastrado; vínculo não criado.`
    });
    return;
  }

  const chave = { clienteId_sindicatoId: { clienteId, sindicatoId: sindicato.id } };
  const atual = await prisma.enquadramentoSindical.findUnique({ where: chave, select: { status: true } });
  if (atual?.status === STATUS_ENQUADRAMENTO.REJEITADO) {
    resumo.vinculosPreservados += 1;
    resumo.rejeitadas.push({
      aba: ABA_EMPRESAS,
      linha: empresa.linha,
      motivo: `Vínculo com ${cnpjSindicato} foi rejeitado pelo DP; mantido como REJEITADO.`
    });
    return;
  }

  const jaConfirmado = atual?.status === STATUS_ENQUADRAMENTO.CONFIRMADO;
  const auditoria = jaConfirmado
    ? {}
    : { validadoPor: `Planilha: ${ABA_EMPRESAS} (linha ${empresa.linha})`, validadoEm: new Date() };

  await prisma.enquadramentoSindical.upsert({
    where: chave,
    update: { tipo, status: STATUS_ENQUADRAMENTO.CONFIRMADO, ...(empresa.grau ? { grau: empresa.grau } : {}), ...auditoria },
    create: {
      clienteId,
      sindicatoId: sindicato.id,
      tipo,
      status: STATUS_ENQUADRAMENTO.CONFIRMADO,
      ...(empresa.grau ? { grau: empresa.grau } : {}),
      ...auditoria
    }
  });
  resumo.vinculosConfirmados += 1;
}

export async function sincronizarCadastros(dados: AdminSheetData): Promise<ResumoSincronizacao> {
  const resumo: ResumoSincronizacao = {
    sindicatos: 0,
    empresas: 0,
    vinculosConfirmados: 0,
    vinculosPreservados: 0,
    rejeitadas: [...dados.rejeitadas]
  };

  for (const sindicato of dados.sindicatos) {
    try {
      const campos = {
        razaoSocial: sindicato.razaoSocial,
        uf: sindicato.uf,
        ativo: sindicato.ativo,
        statusMonitoramento: sindicato.ativo ? 'ATIVO' : 'INATIVO',
        baseTerritorial: sindicato.baseTerritorial,
        ...(sindicato.cidade ? { cidade: sindicato.cidade } : {}),
        ...(sindicato.segmento ? { segmento: sindicato.segmento } : {}),
        ...(sindicato.codigoSindical ? { codigoSindical: sindicato.codigoSindical } : {})
      };
      await prisma.sindicato.upsert({
        where: { cnpj: sindicato.cnpj },
        update: campos,
        create: { cnpj: sindicato.cnpj, ...campos }
      });
      resumo.sindicatos += 1;
    } catch (error) {
      resumo.rejeitadas.push({ aba: ABA_SINDICATOS, linha: sindicato.linha, motivo: motivo(error) });
    }
  }

  for (const empresa of dados.empresas) {
    try {
      const campos = {
        razaoSocial: empresa.razaoSocial,
        cnaePrincipal: empresa.cnaePrincipal,
        cnaesSecundarios: empresa.cnaesSecundarios,
        uf: empresa.uf,
        cidade: empresa.cidade,
        ...(empresa.nomeFantasia ? { nomeFantasia: empresa.nomeFantasia } : {}),
        ...(empresa.descricaoCnae ? { descricaoCnae: empresa.descricaoCnae } : {}),
        ...(empresa.quantidadeFuncionarios !== undefined ? { quantidadeFuncionarios: empresa.quantidadeFuncionarios } : {}),
        ...(empresa.porte ? { porte: empresa.porte } : {}),
        ...(empresa.sindicatoFolha ? { sindicatoFolha: empresa.sindicatoFolha } : {})
      };
      const cliente = await prisma.cliente.upsert({
        where: { cnpj: empresa.cnpj },
        update: campos,
        create: { cnpj: empresa.cnpj, descricaoCnae: '', ...campos },
        select: { id: true }
      });
      resumo.empresas += 1;

      if (empresa.cnpjSindicatoLaboral) await vincular(empresa, cliente.id, empresa.cnpjSindicatoLaboral, 'LABORAL', resumo);
      if (empresa.cnpjSindicatoPatronal) await vincular(empresa, cliente.id, empresa.cnpjSindicatoPatronal, 'PATRONAL', resumo);
    } catch (error) {
      resumo.rejeitadas.push({ aba: ABA_EMPRESAS, linha: empresa.linha, motivo: motivo(error) });
    }
  }

  return resumo;
}

export async function syncAdminSheets(): Promise<ResumoSincronizacao | null> {
  if (env.documentStorageDriver !== 'workspace') {
    console.info('[SYNC] Google Workspace desativado; sincronização dos cadastros ignorada.');
    return null;
  }

  const resumo = await sincronizarCadastros(await readAdminSheetData(env.googleSheetId));
  console.info(
    `[SYNC] Cadastros sincronizados: ${resumo.sindicatos} sindicatos, ${resumo.empresas} empresas, ` +
    `${resumo.vinculosConfirmados} vínculos confirmados, ${resumo.vinculosPreservados} rejeições preservadas.`
  );
  for (const linha of resumo.rejeitadas) {
    console.warn(`[SYNC] ${linha.aba}, linha ${linha.linha}: ${linha.motivo}`);
  }
  return resumo;
}

if (require.main === module) {
  syncAdminSheets()
    .catch(error => {
      console.error('[SYNC] Falha na sincronização dos cadastros:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
