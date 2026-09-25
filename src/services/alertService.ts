import { EventEmitter } from 'node:events';
import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { prisma } from '../db';

export type AlertaTipo = 'NOVA_CCT_MTE' | 'NOTICIA_SITE' | 'DATA_BASE_PROXIMA';
export type Prioridade = 'BAIXA' | 'MEDIA' | 'ALTA';
export type StatusAlerta = 'PENDENTE' | 'EM_ANALISE' | 'RESOLVIDO';

const eventos = new EventEmitter();
eventos.setMaxListeners(0);

async function impacto(sindicatoCnpj: string): Promise<number> {
  return prisma.enquadramentoSindical.count({ where: { sindicato: { cnpj: sindicatoCnpj }, status: 'VALIDADO_DP' } });
}

export async function criarAlerta(input: {
  sindicatoCnpj: string;
  titulo: string;
  mensagem: string;
  tipo: AlertaTipo;
  prioridade: Prioridade;
  chaveUnica: string;
}) {
  const existente = await prisma.alertaDP.findUnique({ where: { chaveUnica: input.chaveUnica } });
  if (existente) return existente;
  const alerta = await prisma.alertaDP.create({ data: { ...input, clientesImpactados: await impacto(input.sindicatoCnpj) } });
  eventos.emit('novo', alerta);
  return alerta;
}

export async function criarAlertaNovaCct(sindicatoCnpj: string, anoVigencia: number) {
  return criarAlerta({
    sindicatoCnpj,
    titulo: 'Nova CCT disponível no MTE',
    mensagem: `O Sistema Mediador publicou a CCT ${anoVigencia}. Verifique os novos pisos e regras e atualize os clientes impactados.`,
    tipo: 'NOVA_CCT_MTE',
    prioridade: 'ALTA',
    chaveUnica: `MTE:${sindicatoCnpj}:${anoVigencia}`
  });
}

export async function criarAlertaNoticiaSite(sindicatoCnpj: string, resumo: string, hash: string) {
  return criarAlerta({
    sindicatoCnpj,
    titulo: 'Nova comunicação no site do sindicato',
    mensagem: `${resumo} A CCT ainda precisa ser confirmada no Sistema Mediador.`,
    tipo: 'NOTICIA_SITE',
    prioridade: 'MEDIA',
    chaveUnica: `SITE:${sindicatoCnpj}:${hash}`
  });
}

export async function gerarAlertasDataBase(): Promise<number> {
  const hoje = new Date();
  if (hoje.getDate() !== 1) return 0;
  const proximoMes = hoje.getMonth() === 11 ? 1 : hoje.getMonth() + 2;
  const sindicatos = await prisma.sindicato.findMany({ where: { ativo: true, mesDataBase: proximoMes } });
  let criados = 0;
  for (const sindicato of sindicatos) {
    const alerta = await criarAlerta({
      sindicatoCnpj: sindicato.cnpj,
      titulo: 'Data-base próxima',
      mensagem: `A data-base de ${sindicato.razaoSocial} se aproxima. Prepare reajustes e provisões para os clientes monitorados.`,
      tipo: 'DATA_BASE_PROXIMA',
      prioridade: 'MEDIA',
      chaveUnica: `BASE:${hoje.getFullYear()}:${proximoMes}:${sindicato.cnpj}`
    });
    if (alerta.dataCriacao.getTime() >= Date.now() - 2_000) criados += 1;
  }
  return criados;
}

export async function listarAlertas(status?: StatusAlerta) {
  return prisma.alertaDP.findMany({
    where: status ? { status } : undefined,
    include: { sindicato: { select: { cnpj: true, razaoSocial: true, uf: true, cidade: true } } },
    orderBy: [{ prioridade: 'desc' }, { dataCriacao: 'desc' }]
  });
}

export async function atualizarAlerta(id: string, status: StatusAlerta) {
  return prisma.alertaDP.update({ where: { id }, data: { status } });
}

export function assinarAlertas(listener: (alerta: unknown) => void): () => void {
  eventos.on('novo', listener);
  return () => eventos.off('novo', listener);
}

export async function enviarDigest(): Promise<void> {
  const alertas = await prisma.alertaDP.findMany({ where: { status: 'PENDENTE' }, include: { sindicato: true }, orderBy: { dataCriacao: 'asc' } });
  if (alertas.length === 0 || !env.smtpHost || !env.alertEmailFrom || !env.alertEmailTo) return;
  const transporter = nodemailer.createTransport({ host: env.smtpHost, port: env.smtpPort, secure: env.smtpPort === 465, auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPassword } : undefined });
  const linhas = alertas.map(alerta => `- [${alerta.prioridade}] ${alerta.sindicato.razaoSocial}: ${alerta.titulo} (${alerta.clientesImpactados} clientes impactados)`);
  await transporter.sendMail({ from: env.alertEmailFrom, to: env.alertEmailTo.split(',').map(email => email.trim()), subject: `BuscaCCT: ${alertas.length} ações pendentes`, text: `Bom dia. A caixa de entrada possui ${alertas.length} ações pendentes:\n\n${linhas.join('\n')}\n\nAcesse o portal para tratar os alertas.` });
}
