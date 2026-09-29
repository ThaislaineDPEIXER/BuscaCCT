import { env } from '../config/env';
import { prisma } from '../db';
import type { EmpresaPlanilha, LinhaRejeitada } from '../services/adminSheetParser';
import { STATUS_ENQUADRAMENTO } from '../services/enquadramentoStatus';
import { preencherCnpjsLaboraisAutomaticos, readAdminSheetData, type AdminSheetData } from '../services/googleWorkspace';

export type ResumoSincronizacao = {
  sindicatos: number;
  empresas: number;
  vinculosConfirmados: number;
  vinculosPreservados: number;
  rejeitadas: LinhaRejeitada[];
};

export type SugestaoVinculoCodigo = { linha: number; cnpjEmpresa: string; cnpjSindicato: string; codigoFolha: string };

function normalizarCodigo(valor: string | undefined): string | undefined {
  const codigo = valor?.trim().match(/^(\d+)(?:\s*\/.*)?$/)?.[1];
  return codigo?.replace(/^0+(?=\d)/, '');
}

export function sugerirVinculosPorCodigo(dados: AdminSheetData): SugestaoVinculoCodigo[] {
  const sindicatosPorCodigo = new Map<string, Set<string>>();
  for (const sindicato of dados.sindicatos) {
    const codigo = normalizarCodigo(sindicato.codigoSindical);
    if (!codigo || !sindicato.ativo) continue;
    const cnpjs = sindicatosPorCodigo.get(codigo) ?? new Set<string>();
    cnpjs.add(sindicato.cnpj);
    sindicatosPorCodigo.set(codigo, cnpjs);
  }

  return dados.empresas.flatMap(empresa => {
    if (empresa.cnpjSindicatoLaboral) return [];
    const codigo = normalizarCodigo(empresa.sindicatoFolha);
    if (!codigo) return [];
    const cnpjs = sindicatosPorCodigo.get(codigo);
    if (!cnpjs || cnpjs.size !== 1) return [];
    return [{ linha: empresa.linha, cnpjEmpresa: empresa.cnpj, cnpjSindicato: [...cnpjs][0], codigoFolha: codigo }];
  });
}

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
    : {
      validadoPor: tipo === 'LABORAL' && empresa.vinculoLaboralAutomatico
        ? `Automático: código de folha único (linha ${empresa.linha})`
        : `Planilha: ${ABA_EMPRESAS} (linha ${empresa.linha})`,
      validadoEm: new Date()
    };

  await prisma.enquadramentoSindical.upsert({
    where: chave,
    update: { tipo, status: STATUS_ENQUADRAMENTO.CONFIRMADO, ...auditoria },
    create: {
      clienteId,
      sindicatoId: sindicato.id,
      tipo,
      status: STATUS_ENQUADRAMENTO.CONFIRMADO,
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
        uf: empresa.uf,
        cidade: empresa.cidade,
        ...(empresa.descricaoCnae ? { descricaoCnae: empresa.descricaoCnae } : {}),
        ...(empresa.codigoErp ? { codigoErp: empresa.codigoErp } : {}),
        ...(empresa.cctRegistro ? { cctRegistro: empresa.cctRegistro } : {}),
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

  const dados = await readAdminSheetData(env.googleSheetId);
  const sugestoes = sugerirVinculosPorCodigo(dados);
  const autorizadas: SugestaoVinculoCodigo[] = [];
  for (const sugestao of sugestoes) {
    const existentes = await prisma.enquadramentoSindical.findMany({
      where: {
        cliente: { cnpj: sugestao.cnpjEmpresa },
        status: { in: [STATUS_ENQUADRAMENTO.CONFIRMADO, STATUS_ENQUADRAMENTO.REJEITADO] }
      },
      select: { status: true, sindicato: { select: { cnpj: true } } }
    });
    const rejeitado = existentes.some(vinculo =>
      vinculo.sindicato.cnpj === sugestao.cnpjSindicato && vinculo.status === STATUS_ENQUADRAMENTO.REJEITADO
    );
    const conflitoConfirmado = existentes.some(vinculo =>
      vinculo.sindicato.cnpj !== sugestao.cnpjSindicato && vinculo.status === STATUS_ENQUADRAMENTO.CONFIRMADO
    );
    if (rejeitado || conflitoConfirmado) {
      console.warn(`[SYNC] Linha ${sugestao.linha}: código de folha ${sugestao.codigoFolha} não preenchido automaticamente por vínculo anterior ${rejeitado ? 'rejeitado' : 'confirmado com outro sindicato'}.`);
      continue;
    }
    autorizadas.push(sugestao);
  }

  const linhasPreenchidas = await preencherCnpjsLaboraisAutomaticos(
    env.googleSheetId,
    autorizadas.map(({ linha, cnpjSindicato }) => ({ linha, cnpjSindicato }))
  );
  const preenchidas = new Map(autorizadas.filter(item => linhasPreenchidas.includes(item.linha)).map(item => [item.linha, item.cnpjSindicato]));
  const dadosAtualizados: AdminSheetData = {
    ...dados,
    empresas: dados.empresas.map(empresa => {
      const cnpjSindicatoLaboral = preenchidas.get(empresa.linha);
      return cnpjSindicatoLaboral ? { ...empresa, cnpjSindicatoLaboral, vinculoLaboralAutomatico: true } : empresa;
    })
  };
  if (preenchidas.size > 0) {
    console.info(`[SYNC] CNPJs laborais preenchidos automaticamente por código ERP único: ${preenchidas.size}.`);
  }
  const resumo = await sincronizarCadastros(dadosAtualizados);
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
