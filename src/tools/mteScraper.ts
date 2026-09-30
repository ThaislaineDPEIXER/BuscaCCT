import crypto from 'node:crypto';
import { BrowserContext, Page, LaunchOptions } from 'playwright';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { prisma } from '../db';
import { env } from '../config/env';
import { criarAlertaNovaCct } from '../services/alertService';
import { extrairTextoPdf } from '../services/cctOcr';
import { storePdf } from '../services/documentStorage';

chromium.use(stealthPlugin());

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class CctUnavailableError extends Error {}
export class CctCaptchaRequiredError extends CctUnavailableError {}
export class CctAccessBlockedError extends CctUnavailableError {}
export class CctManualDownloadRequiredError extends CctUnavailableError {}

export function deveIgnorarPendenciaManual(status: string | undefined, reprocessarPendenciasManuais: boolean): boolean {
  return status === 'PENDENTE_DOWNLOAD_MANUAL' && !reprocessarPendenciasManuais;
}

export function temTextoCctUtilizavel(texto: string | undefined): texto is string {
  return Boolean(texto?.trim());
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

function normalizarCnpj(cnpj: string): string {
  const normalizado = cnpj.replace(/\D/g, '');
  if (normalizado.length !== 14) throw new Error('CNPJ deve conter 14 digitos');
  return normalizado;
}

export function formatarCnpj(cnpj: string): string {
  return normalizarCnpj(cnpj).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

async function selecionarOpcaoPorTexto(page: Page, seletor: string, textoEsperado: string, campo: string): Promise<void> {
  const select = page.locator(seletor);
  if (await select.count() === 0) throw new CctUnavailableError(`Seletor do campo ${campo} nao encontrado no Mediador: ${seletor}`);

  const opcoes = await select.locator('option').evaluateAll(options => options.map(option => ({ label: option.textContent?.trim() ?? '', value: (option as HTMLOptionElement).value })));
  const normalizar = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
  const esperado = normalizar(textoEsperado);
  const opcao = opcoes.find(option => normalizar(option.label) === esperado)
    ?? opcoes.find(option => normalizar(option.label).includes(esperado));
  if (!opcao) throw new CctUnavailableError(`Opcao ${textoEsperado} nao encontrada no campo ${campo}`);
  await select.selectOption(opcao.value);
}

export function anoMaisRecenteDisponivel(textos: string[], anoLimite: number): number | undefined {
  const anos = textos.flatMap(texto => texto.match(/\b(?:19|20)\d{2}\b/g)?.map(Number) ?? [])
    .filter(ano => ano <= anoLimite);
  return anos.length > 0 ? Math.max(...anos) : undefined;
}

async function localizarPrimeiro(page: Page, seletores: string[], campo: string): Promise<ReturnType<Page['locator']>> {
  for (const seletor of seletores) {
    const locator = page.locator(seletor);
    if (await locator.count() > 0) return locator.first();
  }
  throw new CctUnavailableError(`Seletor do campo ${campo} nao encontrado no Mediador: ${seletores.join(', ')}`);
}

type ConsultaMediador = { texto: string; pdf?: Buffer; fonteUrl: string; anoVigencia: number };
export type ResultadoBuscaCct = { texto: string; anoVigencia: number; fonteUrl?: string };

export const MTE_ANTI_BOT_PATTERNS = [
  /just a moment/i,
  /verify you are human/i,
  /cf-chl/i,
  /cloudflare/i,
  /captcha|recaptcha|challenge/i,
  /acesso bloqueado|bloqueou.*acesso|desafio anti-bot/i
];

export function detectarDesafioAntiBot(titulo: string, corpo: string): boolean {
  const texto = `${titulo ?? ''}\n${corpo ?? ''}`.normalize('NFKC');
  return MTE_ANTI_BOT_PATTERNS.some(padrao => padrao.test(texto));
}

export async function buscarESalvarCCTComAno(cnpj: string, anoVigencia: number): Promise<ResultadoBuscaCct> {
  const cnpjNormalizado = normalizarCnpj(cnpj);
  const cache = await prisma.convencaoColetiva.findUnique({
    where: { cnpjSindicato_anoVigencia: { cnpjSindicato: cnpjNormalizado, anoVigencia } }
  });
  if (deveIgnorarPendenciaManual(cache?.status, process.env.RETRY_FAILED_UNION_IMPORTS === 'true')) {
    throw new CctManualDownloadRequiredError(`CCT ${cnpjNormalizado}/${anoVigencia} aguarda PDF manual.`);
  }
  const cacheAtual = cache && cache.status !== 'PENDENTE_DOWNLOAD_MANUAL' && Date.now() - cache.dataAtualizacao.getTime() < CACHE_TTL_MS;
  if (cacheAtual && temTextoCctUtilizavel(cache.textoCompleto)) {
    return { texto: cache.textoCompleto, anoVigencia, fonteUrl: cache.fonteUrl ?? undefined };
  }

  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= env.mteMaxAttempts; tentativa += 1) {
    // Configuração base de lançamento do navegador
    const launchOptions: LaunchOptions = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    };

    // Injeção de Proxy Residencial (se configurado nas variáveis de ambiente / secrets)
    const proxyUrl = process.env.MTE_PROXY_URL;
    if (proxyUrl) {
      try {
        const parsed = new URL(proxyUrl);
        launchOptions.proxy = {
          server: `${parsed.protocol}//${parsed.hostname}:${parsed.port}`,
          username: decodeURIComponent(parsed.username),
          password: decodeURIComponent(parsed.password)
        };
        console.log('[MTE] Navegador configurado para utilizar proxy residencial BR.');
      } catch (err) {
        console.error('[MTE] Erro ao formatar URL do MTE_PROXY_URL:', err);
      }
    }

    const browser = await chromium.launch(launchOptions);
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      const consulta = await consultarMediador(page, context, cnpjNormalizado, anoVigencia);
      const cacheDaConsulta = consulta.anoVigencia === anoVigencia
        ? cache
        : await prisma.convencaoColetiva.findUnique({
          where: { cnpjSindicato_anoVigencia: { cnpjSindicato: cnpjNormalizado, anoVigencia: consulta.anoVigencia } }
        });
      const documento = consulta.pdf
        ? await storePdf(
            consulta.pdf,
            env.documentStoragePath,
            `${cnpjNormalizado}-${consulta.anoVigencia}-${cryptoHash(consulta.pdf)}.pdf`
          )
        : undefined;

      const cct = await prisma.convencaoColetiva.upsert({
        where: { cnpjSindicato_anoVigencia: { cnpjSindicato: cnpjNormalizado, anoVigencia: consulta.anoVigencia } },
        update: {
          textoCompleto: consulta.texto,
          fonteUrl: consulta.fonteUrl,
          documentoStoragePath: documento?.storagePath,
          hashDocumento: documento?.hashSha256,
          dataConsulta: new Date()
        },
        create: {
          cnpjSindicato: cnpjNormalizado,
          anoVigencia: consulta.anoVigencia,
          textoCompleto: consulta.texto,
          fonteUrl: consulta.fonteUrl,
          documentoStoragePath: documento?.storagePath,
          hashDocumento: documento?.hashSha256
        }
      });
      if (documento) {
        await prisma.evidenciaCct.create({
          data: {
            convencaoColetivaId: cct.id,
            tipo: 'DOCUMENTO_MTE',
            url: consulta.fonteUrl,
            storagePath: documento.storagePath,
            hashSha256: documento.hashSha256,
            referencia: 'PDF original capturado no Sistema Mediador.'
          }
        });
      }
      if (!cacheDaConsulta || cacheDaConsulta.textoCompleto !== consulta.texto) {
        await criarAlertaNovaCct(cnpjNormalizado, consulta.anoVigencia).catch(error => console.warn('[ALERTA] Nao foi possivel criar alerta MTE:', error));
      }
      await browser.close();
      return { texto: consulta.texto, anoVigencia: consulta.anoVigencia, fonteUrl: consulta.fonteUrl };
    } catch (error) {
      ultimoErro = error;
      await browser.close();
      if (error instanceof CctCaptchaRequiredError || error instanceof CctAccessBlockedError) break;
      if (tentativa < env.mteMaxAttempts) await wait(2_000 * tentativa);
    }
  }
  if (ultimoErro instanceof CctAccessBlockedError || ultimoErro instanceof CctCaptchaRequiredError) {
    await prisma.convencaoColetiva.upsert({
      where: { cnpjSindicato_anoVigencia: { cnpjSindicato: cnpjNormalizado, anoVigencia } },
      update: { status: 'PENDENTE_DOWNLOAD_MANUAL', fonteTipo: 'MTE' },
      create: {
        cnpjSindicato: cnpjNormalizado,
        anoVigencia,
        textoCompleto: '',
        fonteTipo: 'MTE',
        status: 'PENDENTE_DOWNLOAD_MANUAL'
      }
    });
    throw new CctUnavailableError(`CCT aguardando download manual após bloqueio do Mediador: ${String(ultimoErro)}`);
  }
  if (temTextoCctUtilizavel(cache?.textoCompleto)) {
    return { texto: cache.textoCompleto, anoVigencia, fonteUrl: cache.fonteUrl ?? undefined };
  }
  const cacheAnterior = await prisma.convencaoColetiva.findFirst({
    where: {
      cnpjSindicato: cnpjNormalizado,
      anoVigencia: { lt: anoVigencia },
      status: { not: 'PENDENTE_DOWNLOAD_MANUAL' }
    },
    orderBy: { anoVigencia: 'desc' }
  });
  if (temTextoCctUtilizavel(cacheAnterior?.textoCompleto)) {
    return {
      texto: cacheAnterior.textoCompleto,
      anoVigencia: cacheAnterior.anoVigencia,
      fonteUrl: cacheAnterior.fonteUrl ?? undefined
    };
  }
  throw new CctUnavailableError(`CCT indisponivel no momento: ${String(ultimoErro)}`);
}

export async function buscarESalvarCCT(cnpj: string, anoVigencia: number): Promise<string> {
  return (await buscarESalvarCCTComAno(cnpj, anoVigencia)).texto;
}

function cryptoHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function pesquisarResultadosMediador(
  page: Page,
  botaoPesquisar: ReturnType<Page['locator']>,
  anoLimite: number,
  anoFallback: number,
  priorizarPrimeiro: boolean
): Promise<{ link: ReturnType<Page['locator']>; anoVigencia: number } | null> {
  const navegacao = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => undefined);
  await botaoPesquisar.click();
  await Promise.race([navegacao, wait(1_000)]);
  await page.waitForSelector([env.mteResultSelector, 'table.tabelaResultados', '#tabelaResultados'].join(', '), {
    state: 'visible',
    timeout: env.mteNavigationTimeoutMs
  });

  const linhas = page.locator('table#tabelaResultados tbody tr');
  const candidatas: Array<{ link: ReturnType<Page['locator']>; ano?: number; temAnoExplicito: boolean }> = [];
  for (let indice = 0; indice < await linhas.count(); indice += 1) {
    const linha = linhas.nth(indice);
    const link = linha.locator('a').first();
    if (await link.count() === 0) continue;
    const texto = await linha.innerText();
    candidatas.push({
      link,
      ano: anoMaisRecenteDisponivel([texto], anoLimite),
      temAnoExplicito: /\b(?:19|20)\d{2}\b/.test(texto)
    });
  }

  if (candidatas.length === 0) {
    try {
      const link = await localizarPrimeiro(page, [env.mteResultLinkSelector, 'table.tabelaResultados tbody tr:first-child a'], 'resultado da CCT');
      return { link, anoVigencia: anoFallback };
    } catch {
      return null;
    }
  }

  const escolhida = priorizarPrimeiro
    ? candidatas[0]
    : candidatas.filter(candidata => candidata.ano !== undefined)
      .sort((a, b) => (b.ano ?? 0) - (a.ano ?? 0))[0]
      ?? (candidatas.every(candidata => !candidata.temAnoExplicito) ? candidatas[0] : undefined);
  if (!escolhida) return null;
  return { link: escolhida.link, anoVigencia: escolhida.ano ?? anoFallback };
}

async function consultarMediador(page: Page, context: BrowserContext, cnpj: string, anoVigencia: number): Promise<ConsultaMediador> {
  await page.goto(env.mteUrl, { waitUntil: 'domcontentloaded', timeout: env.mteNavigationTimeoutMs });
  const titulo = await page.title().catch(() => '');
  const corpo = await page.locator('body').innerText().catch(() => '');
  const urlFinal = page.url();
  console.log(`[MTE-DIAGNOSTICO] URL Final: ${urlFinal}`);
  console.log(`[MTE-DIAGNOSTICO] Título da Página: "${titulo}"`);
  console.log(`[MTE-DIAGNOSTICO] Trecho do Texto: "${corpo.substring(0, 200).replace(/\s+/g, ' ')}"`);

  if (detectarDesafioAntiBot(titulo, corpo)) {
    const texto = `${titulo ?? ''}\n${corpo ?? ''}`.normalize('NFKC');
    const padraoEncontrado = MTE_ANTI_BOT_PATTERNS.find(padrao => padrao.test(texto));
    console.warn(`[MTE-DIAGNOSTICO] Detector acionado pelo padrão: ${padraoEncontrado}`);
    throw new CctAccessBlockedError(`Mediador bloqueou o acesso automatizado (Padrão: ${padraoEncontrado})`);
  }
  const captcha = page.locator(env.mteCaptchaSelector);
  if (await captcha.isVisible().catch(() => false)) {
    throw new CctCaptchaRequiredError('Mediador exige CAPTCHA; consulta automatica interrompida');
  }
  const campoCnpj = await localizarPrimeiro(page, [
    env.mteCnpjSelector,
    'input[name="nrCnpjSindicatoLaboral"]',
    'input[name$="txbCnpjCei" i]',
    'input[id$="txbCnpjCei" i]',
    'tr:has-text("CNPJ/CAEPF") input[type="text"]',
    'input[name*="cnpj" i]',
    'input[id*="cnpj" i]',
    'input[placeholder*="00.000.000"]'
  ], 'CNPJ');
  const checkboxCnpj = page.locator('input[type="checkbox"]').first();
  if (await checkboxCnpj.count() > 0 && await checkboxCnpj.isVisible().catch(() => false)) {
    await checkboxCnpj.check();
  }
  await campoCnpj.fill(formatarCnpj(cnpj));
  await selecionarOpcaoPorTexto(page, env.mteTypeSelector, env.mteTypeLabel, 'tipo do instrumento');
  const botaoPesquisar = await localizarPrimeiro(page, [env.mteSearchSelector, 'input[type="submit"][value*="Pesquisar"]', 'button:has-text("Pesquisar")', 'a:has-text("Pesquisar")'], 'pesquisa');

  const vigenciaConfigurada = env.mteValidityLabel.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const rotuloVigentes = vigenciaConfigurada.includes('vigentes') && !vigenciaConfigurada.includes('nao')
    ? env.mteValidityLabel
    : 'Vigentes';
  await selecionarOpcaoPorTexto(page, env.mteValiditySelector, rotuloVigentes, 'vigencia');
  let resultadoSelecionado = await pesquisarResultadosMediador(page, botaoPesquisar, anoVigencia, anoVigencia, true);

  if (!resultadoSelecionado) {
    const anoAnterior = anoVigencia - 1;
    await selecionarOpcaoPorTexto(page, env.mteValiditySelector, 'Nao Vigentes', 'vigencia');
    resultadoSelecionado = await pesquisarResultadosMediador(page, botaoPesquisar, anoAnterior, anoAnterior, false);
  }
  if (!resultadoSelecionado) throw new CctUnavailableError(`Mediador nao encontrou CCT vigente nem nao vigente de ${anoVigencia - 1}`);

  const popup = context.waitForEvent('page', { timeout: 10_000 }).catch(() => null);
  await resultadoSelecionado.link.click();
  const documentPage = (await popup) ?? page;
  await documentPage.waitForLoadState('domcontentloaded');
  let texto = (await documentPage.locator('body').innerText()).trim();
  let pdfBuffer: Buffer | undefined;
  const fonteUrl = documentPage.url();
  if (texto.length < 300) {
    const pdfUrl = documentPage.url();
    const pdf = await context.request.get(pdfUrl, { timeout: env.mteNavigationTimeoutMs });
    const contentType = (pdf.headers()['content-type'] ?? '').toLowerCase();
    if (!pdf.ok() || !contentType.includes('application/pdf')) {
      throw new CctUnavailableError('Mediador retornou texto insuficiente e nao disponibilizou um PDF');
    }
    pdfBuffer = await pdf.body();
    texto = await extrairTextoPdf(pdfBuffer);
  }
  if (!texto) throw new CctUnavailableError('Mediador retornou uma CCT vazia');
  if (documentPage !== page) await documentPage.close();
  return { texto, pdf: pdfBuffer, fonteUrl, anoVigencia: resultadoSelecionado.anoVigencia };
}

export async function listarCnpjsCacheados(): Promise<Array<{ cnpjSindicato: string; anoVigencia: number }>> {
  return prisma.convencaoColetiva.findMany({
    select: { cnpjSindicato: true, anoVigencia: true },
    orderBy: { dataAtualizacao: 'asc' }
  });
}