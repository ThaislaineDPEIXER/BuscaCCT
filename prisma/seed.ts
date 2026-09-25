import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';

type SindicatoSeed = {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia?: string;
  uf: string;
  cidade: string;
  segmento?: string;
  cnae?: string;
};

type ClienteSeed = {
  cnpj: string;
  razaoSocial: string;
  cnaePrincipal: string;
  descricaoCnae: string;
  uf: string;
  cidade: string;
};

const prisma = new PrismaClient();
const dataDirectory = path.join(__dirname, 'data');

function lerJson<T>(nomeArquivo: string): T {
  const caminho = path.join(dataDirectory, nomeArquivo);
  if (!fs.existsSync(caminho)) throw new Error(`Arquivo de seed nao encontrado: ${caminho}`);

  try {
    return JSON.parse(fs.readFileSync(caminho, 'utf8')) as T;
  } catch (error) {
    throw new Error(`JSON invalido em ${nomeArquivo}: ${String(error)}`);
  }
}

function normalizarCnpj(cnpj: string): string {
  const normalizado = cnpj.replace(/\D/g, '');
  if (normalizado.length !== 14) throw new Error(`CNPJ invalido no seed: ${cnpj}`);
  return normalizado;
}

async function carregarSindicatos(): Promise<Map<string, string>> {
  const registros = lerJson<SindicatoSeed[]>('sindicatos.json');
  const idsPorCnpj = new Map<string, string>();

  for (const registro of registros) {
    const cnpj = normalizarCnpj(registro.cnpj);
    const sindicato = await prisma.sindicato.upsert({
      where: { cnpj },
      update: {
        razaoSocial: registro.razaoSocial,
        nomeFantasia: registro.nomeFantasia,
        uf: registro.uf,
        cidade: registro.cidade,
        segmento: registro.segmento,
        cnae: registro.cnae ?? '9420-1/00'
      },
      create: {
        cnpj,
        razaoSocial: registro.razaoSocial,
        nomeFantasia: registro.nomeFantasia,
        uf: registro.uf,
        cidade: registro.cidade,
        segmento: registro.segmento,
        cnae: registro.cnae ?? '9420-1/00'
      }
    });
    idsPorCnpj.set(cnpj, sindicato.id);
  }

  console.info(`[SEED] ${registros.length} sindicatos carregados.`);
  return idsPorCnpj;
}

async function carregarClientes(): Promise<string[]> {
  const registros = lerJson<ClienteSeed[]>('clientes.json');
  const ids: string[] = [];

  for (const registro of registros) {
    const cnpj = normalizarCnpj(registro.cnpj);
    const cliente = await prisma.cliente.upsert({
      where: { cnpj },
      update: {
        razaoSocial: registro.razaoSocial,
        cnaePrincipal: registro.cnaePrincipal,
        descricaoCnae: registro.descricaoCnae,
        uf: registro.uf,
        cidade: registro.cidade
      },
      create: { ...registro, cnpj }
    });
    ids.push(cliente.id);
  }

  console.info(`[SEED] ${registros.length} clientes carregados.`);
  return ids;
}

async function vincularClientes(clienteIds: string[], sindicatosPorCnpj: Map<string, string>): Promise<void> {
  let vinculacoes = 0;

  for (const clienteId of clienteIds) {
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!cliente) continue;

    const sindicato = await prisma.sindicato.findFirst({
      where: { ativo: true, uf: cliente.uf, cidade: cliente.cidade },
      orderBy: { atualizadoEm: 'asc' }
    });
    if (!sindicato || !sindicatosPorCnpj.has(sindicato.cnpj)) continue;

    await prisma.enquadramentoSindical.upsert({
      where: { clienteId_sindicatoId: { clienteId: cliente.id, sindicatoId: sindicato.id } },
      update: { tipo: 'LABORAL', status: 'SUGERIDO_IA' },
      create: { clienteId: cliente.id, sindicatoId: sindicato.id, tipo: 'LABORAL', status: 'SUGERIDO_IA' }
    });
    vinculacoes += 1;
    console.info(`[SEED] ${cliente.razaoSocial} -> ${sindicato.razaoSocial}`);
  }

  console.info(`[SEED] ${vinculacoes} vinculacoes territoriais sugeridas.`);
}

async function main(): Promise<void> {
  console.info('[SEED] Iniciando carga inicial do Modulo DP.');
  const sindicatosPorCnpj = await carregarSindicatos();
  const clienteIds = await carregarClientes();
  await vincularClientes(clienteIds, sindicatosPorCnpj);
  console.info('[SEED] Carga inicial finalizada.');
}

main()
  .catch(error => {
    console.error('[SEED] Falha:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
