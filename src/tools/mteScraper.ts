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
const PADRAO_SEM_RESULTADOS_MTE = /nenhum\s+(?:resultado|registro|instrumento|documento)|nao\s+foram\s+encontrad[oa]s|nao\s+ha\s+resultados|sem\s+resultados|consulta\s+nao\s+retornou\s+resultados/i;

export class CctUnavailableError extends Error {}
export class CctNoResultsError extends CctUnavailableError {}
export class CctCaptchaRequiredError extends CctUnavailableError {}
export class CctAccessBlockedError extends CctUnavailableError {}
export class CctManualDownloadRequiredError extends CctUnavailableError {}

export function deveIgnorarPendenciaManual(status: string | undefined, reprocessarPendenciasManuais: boolean): boolean {
  return status === 'PENDENTE_DOWNLOAD_MANUAL' && !reprocessarPendenciasManuais;
}

export function temTextoCctUtilizavel(texto: string | undefined): texto is string {
  return Boolean(texto?.trim());
}

export function deveInvalidarExtracaoCct(textoAnterior: string | null | undefined, textoAtual: string): boolean {
  return !textoAnterior || textoAnterior !== textoAtual;
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
  const normalizar = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
  const esperado = normalizar(textoEsperado);
  const candidatos: ReturnType<Page['locator']>[] = [];
  const selectConfigurado = page.locator(seletor);
  if (await selectConfigurado.count() > 0) candidatos.push(selectConfigurado.first());
  const selects = page.locator('select');
  for (let indice = 0; indice < await selects.count(); indice += 1) {
    candidatos.push(selects.nth(indice));
  }

  const opcoesPorSelect: Array<{
    select: ReturnType<Page['locator']>;
    opcoes: Array<{ label: string; value: string }>;
  }> = [];
  const rotulosDisponiveis = new Set<string>();
  for (const select of candidatos) {
    if (!await select.isVisible().catch(() => false)) continue;
    const opcoes = await select.locator('option').evaluateAll(options => options.map(option => ({
      label: option.textContent?.trim() ?? '',
      value: (option as HTMLOptionElement).value
    })));
    opcoes.forEach(opcao => rotulosDisponiveis.add(opcao.label));
    opcoesPorSelect.push({ select, opcoes });
  }

  for (const exato of [true, false]) {
    for (const candidato of opcoesPorSelect) {
      const opcao = candidato.opcoes.find(item => exato
        ? normalizar(item.label) === esperado
        : normalizar(item.label).includes(esperado));
      if (!opcao) continue;
      await candidato.select.selectOption(opcao.value);
      return;
    }
  }
  throw new CctUnavailableError(`Opcao ${textoEsperado} nao encontrada no campo ${campo}; seletor configurado: ${seletor}; opcoes disponiveis: ${[...rotulosDisponiveis].join(', ') || 'nenhuma'}`);
}

async function clicarBotaoPesquisar(page: Page, botao: ReturnType<Page['locator']>): Promise<void> {
  const overlay = page.locator('.ui-widget-overlay');
  try {
    await overlay.waitFor({ state: 'hidden', timeout: 5_000 });
  } catch {
    const dialogos = await page.locator('.ui-dialog').evaluateAll(elements => elements
      .filter(element => element.getClientRects().length > 0)
      .map(element => ({
        titulo: element.querySelector('.ui-dialog-title')?.textContent?.trim() ?? '',
        texto: (element as HTMLElement).innerText.trim(),
        botoes: Array.from(element.querySelectorAll('button, input[type="button"], input[type="submit"]'))
          .map(button => (button.textContent || (button as HTMLInputElement).value).trim())
      })));
    throw new CctUnavailableError(`Mediador manteve overlay bloqueando a pesquisa. Dialogos: ${JSON.stringify(dialogos)}`);
  }
  await botao.click();
}

async function fecharAlertaSemResultados(page: Page): Promise<void> {
  const dialogos = page.locator('.ui-dialog');
  for (let indice = 0; indice < await dialogos.count(); indice += 1) {
    const dialogo = dialogos.nth(indice);
    if (!await dialogo.isVisible().catch(() => false)) continue;
    const texto = await dialogo.innerText().catch(() => '');
    if (!detectarSemResultadosMediador(texto)) continue;

    const botaoOk = dialogo.getByRole('button', { name: /^ok$/i });
    if (await botaoOk.count() === 0) {
      throw new CctUnavailableError(`Alerta sem resultados nao possui botao OK: ${texto.replace(/\s+/g, ' ')}`);
    }
    await botaoOk.click();
    await page.locator('.ui-widget-overlay').waitFor({ state: 'hidden', timeout: 5_000 });
    return;
  }
}

export function anoMaisRecenteDisponivel(textos: string[], anoLimite: number): number | undefined {
  const anos = textos.flatMap(texto => texto.match(/\b(?:19|20)\d{2}\b/g)?.map(Number) ?? [])
    .filter(ano => ano <= anoLimite);
  return anos.length > 0 ? Math.max(...anos) : undefined;
}

async function localizarPrimeiro(page: Page, seletores: string[], campo: string, exigirVisivel = false): Promise<ReturnType<Page['locator']>> {
  for (const seletor of seletores) {
    const locator = page.locator(seletor);
    if (await locator.count() > 0 && (!exigirVisivel || await locator.first().isVisible().catch(() => false))) return locator.first();
  }
  const estado = exigirVisivel ? 'nao encontrado ou invisivel' : 'nao encontrado';
  throw new CctUnavailableError(`Seletor do campo ${campo} ${estado} no Mediador: ${seletores.join(', ')}`);
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

export function detectarSemResultadosMediador(texto: string): boolean {
  const normalizado = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  return PADRAO_SEM_RESULTADOS_MTE.test(normalizado);
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
      const invalidarExtracao = deveInvalidarExtracaoCct(cacheDaConsulta?.textoCompleto, consulta.texto);
      const liberarPendenciaManual = cacheDaConsulta?.status === 'PENDENTE_DOWNLOAD_MANUAL';

      const cct = await prisma.convencaoColetiva.upsert({
        where: { cnpjSindicato_anoVigencia: { cnpjSindicato: cnpjNormalizado, anoVigencia: consulta.anoVigencia } },
        update: {
          textoCompleto: consulta.texto,
          fonteUrl: consulta.fonteUrl,
          documentoStoragePath: documento?.storagePath ?? (invalidarExtracao ? null : undefined),
          hashDocumento: documento?.hashSha256 ?? (invalidarExtracao ? null : undefined),
          fonteTipo: invalidarExtracao ? 'MTE' : undefined,
          status: invalidarExtracao || liberarPendenciaManual ? 'CAPTURADA' : undefined,
          parametrosJson: invalidarExtracao ? null : undefined,
          resumoCct: invalidarExtracao ? null : undefined,
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
      if (error instanceof CctCaptchaRequiredError || error instanceof CctAccessBlockedError || error instanceof CctNoResultsError) break;
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
  await clicarBotaoPesquisar(page, botaoPesquisar);
  await Promise.race([navegacao, wait(1_000)]);
  const seletorResultados = [env.mteResultSelector, 'table.tabelaResultados', '#tabelaResultados'].join(', ');
  const resultadoHandle = await page.waitForFunction(({ seletor, padraoSemResultados }) => {
    const tabelas = Array.from(document.querySelectorAll(seletor));
    if (tabelas.some(tabela => (tabela as HTMLElement).getClientRects().length > 0)) return 'resultados';
    const texto = (document.body?.innerText ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
    return new RegExp(padraoSemResultados, 'i').test(texto) ? 'sem-resultados' : false;
  }, { seletor: seletorResultados, padraoSemResultados: PADRAO_SEM_RESULTADOS_MTE.source }, { timeout: env.mteNavigationTimeoutMs })
    .catch(() => undefined);
  const estadoPesquisa = resultadoHandle
    ? await resultadoHandle.jsonValue() as 'resultados' | 'sem-resultados'
    : undefined;

  if (estadoPesquisa === 'sem-resultados') {
    await fecharAlertaSemResultados(page);
    return null;
  }
  if (!estadoPesquisa) {
    const titulo = await page.title().catch(() => '');
    const corpo = await page.locator('body').innerText().catch(() => '');
    if (detectarDesafioAntiBot(titulo, corpo)) {
      throw new CctAccessBlockedError(`Mediador bloqueou a consulta após a pesquisa: ${titulo} ${corpo.substring(0, 300).replace(/\s+/g, ' ')}`);
    }
    if (await page.locator(env.mteCaptchaSelector).isVisible().catch(() => false)) {
      throw new CctCaptchaRequiredError('Mediador exige CAPTCHA após a pesquisa');
    }
    const tabelas = await page.locator('table').evaluateAll(elements => elements.map(element => ({
      id: element.id,
      classe: element.className,
      linhas: element.querySelectorAll('tbody tr').length
    })));
    throw new CctUnavailableError(`Mediador nao apresentou resultados apos a pesquisa. URL: ${page.url()}; titulo: ${titulo}; tabelas: ${JSON.stringify(tabelas)}; texto: ${corpo.substring(0, 500).replace(/\s+/g, ' ')}`);
  }

  const tabelaResultados = page.locator(seletorResultados).filter({ visible: true }).first();
  const linhas = tabelaResultados.locator('tbody tr');
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
    const primeiroLink = tabelaResultados.locator('tbody tr:first-child a').first();
    if (await primeiroLink.count() > 0) return { link: primeiroLink, anoVigencia: anoFallback };
    try {
      const link = await localizarPrimeiro(page, [env.mteResultLinkSelector], 'resultado da CCT');
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
  const seletoresCnpj = [
    env.mteCnpjSelector,
    'input[name="nrCnpjSindicatoLaboral"]',
    'input[name$="txbCnpjCei" i]',
    'input[id$="txbCnpjCei" i]',
    'tr:has-text("CNPJ/CAEPF") input[type="text"]',
    'input[name*="cnpj" i]',
    'input[id*="cnpj" i]',
    'input[placeholder*="00.000.000"]'
  ];
  await page.waitForSelector(seletoresCnpj.join(', '), {
    state: 'visible',
    timeout: env.mteNavigationTimeoutMs
  });
  const campoCnpj = await localizarPrimeiro(page, seletoresCnpj, 'CNPJ', true);
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
  if (!resultadoSelecionado) throw new CctNoResultsError(`Mediador nao encontrou CCT vigente nem nao vigente de ${anoVigencia - 1}`);

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