import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { chromium } from 'playwright';
import { env } from '../config/env';
import { prisma } from '../db';
import { runWithAiProviderFallback } from './aiResilience';
import { criarAlertaNoticiaSite } from './alertService';
import { storePdf } from './documentStorage';

const anthropic = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;
const gemini = env.geminiApiKey ? new GoogleGenerativeAI(env.geminiApiKey) : null;
const CNAE_SINDICATO = '9420-1/00';
const INTERESSE = /noticia|notícia|convencao|convenção|acordo|reajuste|negociacao|negociação|cct/i;
const SYSTEM_PROMPT_RADAR = 'Responda somente JSON valido. Nao invente percentuais, datas ou clausulas que nao estejam no texto.';

export interface SindicatoInput {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia?: string;
  uf: string;
  cidade: string;
  cnae: string;
}

export interface RadarResultado {
  nova_cct_encontrada: boolean;
  resumo_comunicado: string | null;
  evidencias: string[];
}

type CctExistenteResumo = {
  fonteTipo: string;
  status: string;
  textoCompleto: string;
};

function normalizarCnpj(cnpj: string): string {
  const valor = cnpj.replace(/\D/g, '');
  if (valor.length !== 14) throw new Error('CNPJ deve conter 14 digitos');
  return valor;
}

export function classificarSegmento(texto: string): string | null {
  if (/metalurg|textil|têxtil|industr/i.test(texto)) return 'industria';
  if (/comercio|comércio|vendas|lojist/i.test(texto)) return 'comercio';
  if (/\bti\b|informatica|informática|processamento de dados|tecnologia/i.test(texto)) return 'tecnologia';
  return null;
}

export async function importarSindicatos(registros: SindicatoInput[]): Promise<number> {
  let importados = 0;
  for (const registro of registros) {
    if (registro.cnae.replace(/\s/g, '') !== CNAE_SINDICATO.replace(/\s/g, '')) continue;
    const cnpj = normalizarCnpj(registro.cnpj);
    await prisma.sindicato.upsert({
      where: { cnpj },
      update: { razaoSocial: registro.razaoSocial, nomeFantasia: registro.nomeFantasia, uf: registro.uf, cidade: registro.cidade, cnae: registro.cnae, segmento: classificarSegmento(`${registro.razaoSocial} ${registro.nomeFantasia ?? ''}`) },
      create: { cnpj, razaoSocial: registro.razaoSocial, nomeFantasia: registro.nomeFantasia, uf: registro.uf, cidade: registro.cidade, cnae: registro.cnae, segmento: classificarSegmento(`${registro.razaoSocial} ${registro.nomeFantasia ?? ''}`) }
    });
    importados += 1;
  }
  return importados;
}

export async function buscarLinkOficial(sindicato: { razaoSocial: string; cidade: string; uf: string }): Promise<string> {
  if (!env.googleApiKey || !env.googleSearchEngineId) throw new Error('Google Custom Search nao configurado');
  const query = `${sindicato.razaoSocial} ${sindicato.cidade} ${sindicato.uf} site oficial convencao`;
  const resposta = await axios.get('https://www.googleapis.com/customsearch/v1', {
    params: { q: query, key: env.googleApiKey, cx: env.googleSearchEngineId }, timeout: 15_000
  });
  const link = resposta.data?.items?.find((item: { link?: string }) => typeof item.link === 'string')?.link;
  if (!link) throw new Error('Nenhum site encontrado para o sindicato');
  const url = new URL(link);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Resultado de busca nao e HTTP');
  return url.toString();
}

async function rastrearSite(urlInicial: string): Promise<{ texto: string; url: string; links: string[] }> {
  const origem = new URL(urlInicial);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    const pendentes = [origem.toString()];
    const visitados = new Set<string>();
    const paginas: string[] = [];
    const linksDocumentos = new Set<string>();
    let texto = '';

    while (pendentes.length > 0 && paginas.length < env.radarMaxPages) {
      const url = pendentes.shift()!;
      if (visitados.has(url)) continue;
      visitados.add(url);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        const paginaTexto = await page.locator('body').innerText();
        texto += `\nURL: ${url}\n${paginaTexto.slice(0, 12_000)}`;
        paginas.push(url);
        const links = await page.locator('a').evaluateAll(anchors => anchors.map(anchor => ({ href: (anchor as HTMLAnchorElement).href, label: anchor.textContent ?? '' })));
        for (const link of links) {
          try {
            const destino = new URL(link.href, url);
            if (destino.origin === origem.origin && /\.pdf(?:$|[?#])/i.test(destino.href) && INTERESSE.test(`${destino.href} ${link.label}`)) {
              linksDocumentos.add(destino.toString());
            }
            if (destino.origin === origem.origin && INTERESSE.test(`${destino.href} ${link.label}`) && !visitados.has(destino.href)) pendentes.push(destino.href);
          } catch { /* ignora links invalidos */ }
        }
      } catch (error) {
        console.warn(`[RADAR] Falha ao acessar ${url}:`, error);
      }
      await new Promise(resolve => setTimeout(resolve, env.radarRequestDelayMs));
    }
    if (!texto.trim()) throw new Error('Site sem texto acessivel');
    return { texto: texto.slice(0, 50_000), url: paginas[0] ?? urlInicial, links: [...linksDocumentos] };
  } finally {
    await browser.close();
  }
}

function montarPromptRadar(sindicato: string, texto: string): string {
  return `Analise as publicacoes do sindicato ${sindicato}. Identifique comunicados sobre nova CCT, ACT ou reajuste salarial. Responda exatamente com {"nova_cct_encontrada": boolean, "resumo_comunicado": string|null, "evidencias": string[]}. Texto:\n${texto}`;
}

function validarRadarResultado(bruto: string): RadarResultado {
  const resultado = JSON.parse(bruto.replace(/^```json\s*|\s*```$/g, '').trim()) as RadarResultado;
  if (typeof resultado.nova_cct_encontrada !== 'boolean' || !Array.isArray(resultado.evidencias)) throw new Error('Resposta do Claude fora do contrato');
  return resultado;
}

async function analisarTextoComAnthropic(sindicato: string, texto: string): Promise<RadarResultado> {
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY nao configurada');
  const resposta = await anthropic.messages.create({
    model: env.anthropicModel,
    max_tokens: 800,
    system: SYSTEM_PROMPT_RADAR,
    messages: [{ role: 'user', content: montarPromptRadar(sindicato, texto) }]
  });
  const bruto = resposta.content
    .filter((item): item is Anthropic.TextBlock => item.type === 'text')
    .map(item => item.text)
    .join('');
  return validarRadarResultado(bruto);
}

async function analisarTextoComGemini(sindicato: string, texto: string): Promise<RadarResultado> {
  if (!gemini) throw new Error('GEMINI_API_KEY nao configurada');
  const model = gemini.getGenerativeModel({
    model: env.geminiModel,
    systemInstruction: SYSTEM_PROMPT_RADAR,
    generationConfig: { temperature: 0, responseMimeType: 'application/json' }
  });
  const resposta = await model.generateContent(montarPromptRadar(sindicato, texto));
  return validarRadarResultado(resposta.response.text());
}

async function analisarTexto(sindicato: string, texto: string): Promise<RadarResultado> {
  return runWithAiProviderFallback({
    provider: env.aiProvider as 'anthropic' | 'gemini',
    operation: 'radar-sindical',
    handlers: {
      gemini: gemini ? () => analisarTextoComGemini(sindicato, texto) : undefined,
      anthropic: anthropic ? () => analisarTextoComAnthropic(sindicato, texto) : undefined
    }
  });
}

export function devePreservarCctMteComoFontePrincipal(existente: CctExistenteResumo | null | undefined): boolean {
  return Boolean(
    existente
    && existente.fonteTipo === 'MTE'
    && existente.status !== 'PENDENTE_DOWNLOAD_MANUAL'
    && existente.textoCompleto.trim()
  );
}

export async function varrerSindicato(id: string): Promise<RadarResultado> {
  const sindicato = await prisma.sindicato.findUnique({ where: { id } });
  if (!sindicato) throw new Error('Sindicato nao encontrado');
  const url = sindicato.siteUrl ?? await buscarLinkOficial(sindicato);
  const rastreado = await rastrearSite(url);
  const resultado = await analisarTexto(sindicato.razaoSocial, rastreado.texto);
  const textoHash = crypto.createHash('sha256').update(rastreado.texto).digest('hex');
  const anterior = await prisma.radarScan.findFirst({ where: { sindicatoId: id }, orderBy: { consultadoEm: 'desc' }, select: { textoHash: true } });
  const conteudoNovo = anterior?.textoHash !== textoHash;
  await prisma.sindicato.update({
    where: { id },
    data: {
      siteUrl: rastreado.url,
      siteOficial: rastreado.url,
      ultimaVarredura: new Date(),
      ultimaVarreduraSite: new Date()
    }
  });
  await prisma.radarScan.create({ data: { sindicatoId: id, urlConsultada: rastreado.url, novaCct: resultado.nova_cct_encontrada, resumo: resultado.resumo_comunicado, evidencias: JSON.stringify(resultado.evidencias), textoHash } });
  if (conteudoNovo && resultado.nova_cct_encontrada && resultado.resumo_comunicado) await criarAlertaNoticiaSite(sindicato.cnpj, resultado.resumo_comunicado, textoHash);
  return resultado;
}

function anoDoDocumento(url: string, texto: string): number {
  const anoAtual = new Date().getFullYear();
  const encontrado = `${url} ${texto.slice(0, 2_000)}`.match(/\b(20\d{2})\b/);
  const ano = encontrado ? Number(encontrado[1]) : anoAtual;
  return ano >= 2000 && ano <= anoAtual + 1 ? ano : anoAtual;
}

export async function buscarCctNoSite(sindicatoId: string): Promise<{ cctId: string; fonteUrl: string; anoVigencia: number }> {
  const sindicato = await prisma.sindicato.findUnique({ where: { id: sindicatoId } });
  if (!sindicato) throw new Error('Sindicato nao encontrado');
  const urlInicial = sindicato.siteUrl ?? sindicato.siteOficial;
  if (!urlInicial) throw new Error('Sindicato nao possui site oficial cadastrado para fallback');

  const rastreado = await rastrearSite(urlInicial);
  const documentoUrl = rastreado.links[0];
  if (!documentoUrl) throw new Error('Nenhum PDF de CCT ou ACT foi encontrado no site do sindicato');

  const resposta = await axios.get<ArrayBuffer>(documentoUrl, {
    responseType: 'arraybuffer',
    timeout: env.mteNavigationTimeoutMs,
    maxContentLength: 25 * 1024 * 1024,
    validateStatus: status => status >= 200 && status < 300
  });
  const pdf = Buffer.from(resposta.data);
  const contentType = String(resposta.headers['content-type'] ?? '').toLowerCase();
  if (!contentType.includes('application/pdf') && !/\.pdf(?:$|[?#])/i.test(documentoUrl)) {
    throw new Error('O documento encontrado no site nao e um PDF verificavel');
  }

  const { extrairTextoPdf } = await import('./cctOcr');
  const texto = await extrairTextoPdf(pdf);
  const anoVigencia = anoDoDocumento(documentoUrl, texto);
  const hashDocumento = crypto.createHash('sha256').update(pdf).digest('hex');
  const documento = await storePdf(
    pdf,
    env.documentStoragePath,
    `${sindicato.cnpj}-${anoVigencia}-${hashDocumento}.pdf`
  );
  const existente = await prisma.convencaoColetiva.findUnique({
    where: { cnpjSindicato_anoVigencia: { cnpjSindicato: sindicato.cnpj, anoVigencia } }
  });

  if (existente && devePreservarCctMteComoFontePrincipal(existente)) {
    await prisma.evidenciaCct.create({
      data: {
        convencaoColetivaId: existente.id,
        tipo: 'DOCUMENTO_SITE_COMPLEMENTAR',
        url: documentoUrl,
        storagePath: documento.storagePath,
        hashSha256: hashDocumento,
        referencia: 'Documento encontrado no site oficial; CCT MTE preservada como fonte principal.'
      }
    });
    return { cctId: existente.id, fonteUrl: documentoUrl, anoVigencia };
  }

  const cct = await prisma.convencaoColetiva.upsert({
    where: { cnpjSindicato_anoVigencia: { cnpjSindicato: sindicato.cnpj, anoVigencia } },
    update: {
      textoCompleto: texto,
      fonteTipo: 'SITE',
      fonteUrl: documentoUrl,
      documentoStoragePath: documento.storagePath,
      hashDocumento: documento.hashSha256,
      status: 'CAPTURADA',
      dataConsulta: new Date()
    },
    create: {
      cnpjSindicato: sindicato.cnpj,
      anoVigencia,
      textoCompleto: texto,
      fonteTipo: 'SITE',
      fonteUrl: documentoUrl,
      documentoStoragePath: documento.storagePath,
      hashDocumento: documento.hashSha256,
      status: 'CAPTURADA'
    }
  });

  await prisma.evidenciaCct.create({
    data: {
      convencaoColetivaId: cct.id,
      tipo: 'DOCUMENTO_SITE',
      url: documentoUrl,
      storagePath: documento.storagePath,
      hashSha256: documento.hashSha256,
      referencia: 'PDF capturado no site oficial do sindicato.'
    }
  });
  return { cctId: cct.id, fonteUrl: documentoUrl, anoVigencia };
}

export async function estadoFallbackSindicato(sindicatoId: string): Promise<{
  sindicatoId: string;
  fonte: 'site';
  disponivel: boolean;
  siteUrl?: string | null;
  siteOficial?: string | null;
  mensagem: string;
}> {
  const sindicato = await prisma.sindicato.findUnique({ where: { id: sindicatoId } });
  if (!sindicato) {
    throw new Error('Sindicato nao encontrado');
  }

  const siteUrl = sindicato.siteUrl ?? null;
  const siteOficial = sindicato.siteOficial ?? null;
  if (!siteUrl && !siteOficial) {
    return {
      sindicatoId,
      fonte: 'site',
      disponivel: false,
      siteUrl: null,
      siteOficial: null,
      mensagem: 'fallback por site indisponível: o sindicato ainda não possui URL oficial cadastrada para descoberta de CCT fora do MTE.'
    };
  }

  return {
    sindicatoId,
    fonte: 'site',
    disponivel: false,
    siteUrl,
    siteOficial,
    mensagem: 'fallback por site em fila de descoberta. A verificação de PDF/ATA e a extração de texto ainda dependem da varredura ativa do radar.'
  };
}

export async function varrerSindicatosAtivos(): Promise<void> {
  const sindicatos = await prisma.sindicato.findMany({
    where: { ativo: true, enquadramentos: { some: { status: 'VALIDADO_DP' } } },
    select: { id: true }
  });
  for (const sindicato of sindicatos) {
    try { await varrerSindicato(sindicato.id); } catch (error) { console.error(`[RADAR] Falha no sindicato ${sindicato.id}:`, error); }
    await new Promise(resolve => setTimeout(resolve, env.radarRequestDelayMs));
  }
}
