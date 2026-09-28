import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { prisma } from '../db';
import { STATUS_ENQUADRAMENTO } from './enquadramentoStatus';

const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });
const STATUS_SUGERIDO = STATUS_ENQUADRAMENTO.PENDENTE;
const STATUS_VALIDADO = STATUS_ENQUADRAMENTO.CONFIRMADO;

type ClienteInput = {
  cnpj: string;
  razaoSocial: string;
  cnaePrincipal: string;
  descricaoCnae: string;
  uf: string;
  cidade: string;
};

type EscolhasIA = { laboral_cnpj: string | null; patronal_cnpj: string | null };

function normalizarCnpj(cnpj: string): string {
  const valor = cnpj.replace(/\D/g, '');
  if (valor.length !== 14) throw new Error('CNPJ deve conter 14 digitos');
  return valor;
}

async function buscarCandidatos(cliente: ClienteInput) {
  const municipais = await prisma.sindicato.findMany({
    where: { ativo: true, uf: cliente.uf, cidade: cliente.cidade },
    select: { id: true, cnpj: true, razaoSocial: true, nomeFantasia: true, uf: true, cidade: true, segmento: true },
    take: 50
  });
  const ids = municipais.map(sindicato => sindicato.id);
  const estaduais = await prisma.sindicato.findMany({
    where: { ativo: true, uf: cliente.uf, id: { notIn: ids } },
    select: { id: true, cnpj: true, razaoSocial: true, nomeFantasia: true, uf: true, cidade: true, segmento: true },
    take: Math.max(0, 50 - municipais.length)
  });
  return [...municipais, ...estaduais];
}

function lerJson(texto: string): EscolhasIA {
  const bruto = texto.replace(/^```json\s*|\s*```$/g, '').trim();
  const escolhas = JSON.parse(bruto) as Partial<EscolhasIA>;
  return {
    laboral_cnpj: escolhas.laboral_cnpj ? normalizarCnpj(escolhas.laboral_cnpj) : null,
    patronal_cnpj: escolhas.patronal_cnpj ? normalizarCnpj(escolhas.patronal_cnpj) : null
  };
}

export async function criarClienteESugerir(clienteInput: ClienteInput) {
  const cliente = await prisma.cliente.upsert({
    where: { cnpj: normalizarCnpj(clienteInput.cnpj) },
    update: { razaoSocial: clienteInput.razaoSocial, cnaePrincipal: clienteInput.cnaePrincipal, descricaoCnae: clienteInput.descricaoCnae, uf: clienteInput.uf, cidade: clienteInput.cidade },
    create: { ...clienteInput, cnpj: normalizarCnpj(clienteInput.cnpj) }
  });
  const candidatos = await buscarCandidatos({ ...clienteInput, cnpj: cliente.cnpj });
  if (candidatos.length === 0) return { cliente, candidatos, sugestoes: [] };

  const resposta = await anthropic.messages.create({
    model: env.anthropicModel,
    max_tokens: 500,
    system: 'Responda somente JSON valido. Escolha apenas CNPJs presentes na lista. Se nao houver confianca, use null. Nao trate sugestao como validacao juridica.',
    messages: [{ role: 'user', content: `Atue como analista de enquadramento sindical. Cliente: ${JSON.stringify({ cnae: cliente.cnaePrincipal, descricao: cliente.descricaoCnae, cidade: cliente.cidade, uf: cliente.uf })}. Candidatos territoriais: ${JSON.stringify(candidatos)}. Retorne {"laboral_cnpj": string|null, "patronal_cnpj": string|null}.` }]
  });
  const texto = resposta.content.filter((item): item is Anthropic.TextBlock => item.type === 'text').map(item => item.text).join('');
  const escolhas = lerJson(texto);
  const permitidos = new Set(candidatos.map(candidato => candidato.cnpj));
  const selecionados = [
    { cnpj: escolhas.laboral_cnpj, tipo: 'LABORAL' },
    { cnpj: escolhas.patronal_cnpj, tipo: 'PATRONAL' }
  ].filter(escolha => escolha.cnpj && permitidos.has(escolha.cnpj));

  for (const escolha of selecionados) {
    const sindicato = candidatos.find(candidato => candidato.cnpj === escolha.cnpj)!;
    const atual = await prisma.enquadramentoSindical.findUnique({ where: { clienteId_sindicatoId: { clienteId: cliente.id, sindicatoId: sindicato.id } } });
    if (atual?.status === STATUS_VALIDADO || atual?.status === STATUS_ENQUADRAMENTO.REJEITADO) continue;
    await prisma.enquadramentoSindical.upsert({
      where: { clienteId_sindicatoId: { clienteId: cliente.id, sindicatoId: sindicato.id } },
      update: { tipo: escolha.tipo, status: STATUS_SUGERIDO },
      create: { clienteId: cliente.id, sindicatoId: sindicato.id, tipo: escolha.tipo, status: STATUS_SUGERIDO }
    });
  }
  return { cliente, candidatos, sugestoes: selecionados };
}

export async function listarEnquadramentos(clienteId?: string) {
  return prisma.enquadramentoSindical.findMany({
    where: clienteId ? { clienteId } : undefined,
    include: { cliente: true, sindicato: true },
    orderBy: { atualizadoEm: 'desc' }
  });
}

export async function validarEnquadramento(id: string) {
  const enquadramento = await prisma.enquadramentoSindical.findUnique({ where: { id } });
  if (!enquadramento) throw new Error('Enquadramento nao encontrado');
  return prisma.enquadramentoSindical.update({ where: { id }, data: { status: STATUS_VALIDADO, validadoEm: new Date() } });
}

export async function listarSindicatosMonitorados() {
  return prisma.sindicato.findMany({
    where: { enquadramentos: { some: { status: STATUS_VALIDADO } } },
    distinct: ['id'],
    select: { id: true, cnpj: true, razaoSocial: true, uf: true, cidade: true }
  });
}
