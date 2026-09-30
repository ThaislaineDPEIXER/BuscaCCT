import crypto from 'node:crypto';
import { BrowserContext, chromium, Page, LaunchOptions } from 'playwright';
import { prisma } from '../db';
import { env } from '../config/env';
import { criarAlertaNovaCct } from '../services/alertService';
import { extrairTextoPdf } from '../services/cctOcr';
import { storePdf } from '../services/documentStorage';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class CctUnavailableError extends Error {}
export class CctCaptchaRequiredError extends CctUnavailableError {}
export class CctAccessBlockedError extends CctUnavailableError {}
export class CctManualDownloadRequiredError extends CctUnavailableError {}

export function deveIgnorarPendenciaManual(status: string | undefined, reprocessarPendenciasManuais: boolean): boolean {
  return status === 'PENDENTE_DOWNLOAD_MANUAL' && !reprocessarPendenciasManuais;
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

function normalizarCnpj(cnpj: string): string {
  const normalizado = cnpj.replace(/\D/g, '');
  if (normalizado.length !== 14) throw new Error('CNPJ deve conter 14 digitos');
  return normalizado;
}

async function selecionarOpcaoPorTexto(page: Page, seletor: string, textoEsperado: string, campo: string): Promise<void> {
  const select = page.locator(seletor);
  if (await select.count() === 0) throw new CctUnavailableError(`Seletor do campo ${campo} nao encontrado no Mediador: ${seletor}`);

  const opcoes = await select.locator('option').evaluateAll(options => options.map(option => ({ label: option.textContent?.trim() ?? '', value: (option as HTMLOptionElement).value })));
  const opcao = opcoes.find(option => option.label.toLocaleLowerCase().includes(textoEsperado.toLocaleLowerCase()));
  if (!opcao) throw new CctUnavailableError(`Opcao ${textoEsperado} nao encontrada no campo ${campo}`);
  await select.selectOption(opcao.value);
}

async function localizarPrimeiro(page: Page, seletores: string[], campo: string): Promise<ReturnType<Page['locator']>> {
  for (const seletor of seletores) {
    const locator = page.locator(seletor);
    if (await locator.count() > 0) return locator.first();
  }
  throw new CctUnavailableError(`Seletor do campo ${campo} nao encontrado no Mediador: ${seletores.join(', ')}`);
}

type ConsultaMediador = { texto: string; pdf?: Buffer; fonteUrl: string };

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

export async function buscarESalvarCCT(cnpj: string, anoVigencia: number): Promise<string> {
  const cnpjNormalizado = normalizarCnpj(cnpj);
  const cache = await prisma.convencaoColetiva.findUnique({
    where: { cnpjSindicato_anoVigencia: { cnpjSindicato: cnpjNormalizado, anoVigencia } }
  });
  if (deveIgnorarPendenciaManual(cache?.status, process.env.RETRY_FAILED_UNION_IMPORTS === 'true')) {
    throw new CctManualDownloadRequiredError(`CCT ${cnpjNormalizado}/${anoVigencia} aguarda PDF manual.`);
  }
  const cacheAtual = cache && cache.status !== 'PENDENTE_DOWNLOAD_MANUAL' && Date.now() - cache.dataAtualizacao.getTime() < CACHE_TTL_MS;
  if (cacheAtual) return cache.textoCompleto;

  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= env.mteMaxAttempts; tentativa += 1) {
    // Configuração base de lançamento do navegador
    const launchOptions: LaunchOptions = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
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
      const documento = consulta.pdf
        ? await storePdf(
            consulta.pdf,
            env.documentStoragePath,
            `${cnpjNormalizado}-${anoVigencia}-${cryptoHash(consulta.pdf)}.pdf`
          )
        : undefined;

      const cct = await prisma.convencaoColetiva.upsert({
        where: { cnpjSindicato_anoVigencia: { cnpjSindicato: cnpjNormalizado, anoVigencia } },
        update: {
          textoCompleto: consulta.texto,
          fonteUrl: consulta.fonteUrl,
          documentoStoragePath: documento?.storagePath,
          hashDocumento: documento?.hashSha256,
          dataConsulta: new Date()
        },
        create: {
          cnpjSindicato: cnpjNormalizado,
          anoVigencia,
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
      if (!cache || cache.textoCompleto !== consulta.texto) {
        await criarAlertaNovaCct(cnpjNormalizado, anoVigencia).catch(error => console.warn('[ALERTA] Nao foi possivel criar alerta MTE:', error));
      }
      await browser.close();
      return consulta.texto;
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
  if (cache) return cache.textoCompleto;
  throw new CctUnavailableError(`CCT indisponivel no momento: ${String(ultimoErro)}`);
}

function cryptoHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function consultarMediador(page: Page, context: BrowserContext, cnpj: string, anoVigencia: number): Promise<ConsultaMediador> {
  await page.goto(env.mteUrl, { waitUntil: 'domcontentloaded', timeout: env.mteNavigationTimeoutMs });
  const titulo = await page.title().catch(() => '');
  const corpo = await page.locator('body').innerText().catch(() => '');
  if (detectarDesafioAntiBot(titulo, corpo)) {
    throw new CctAccessBlockedError('Mediador bloqueou o acesso automatizado com um desafio anti-bot');
  }
  const captcha = page.locator(env.mteCaptchaSelector);
  if (await captcha.isVisible().catch(() => false)) {
    throw new CctCaptchaRequiredError('Mediador exige CAPTCHA; consulta automatica interrompida');
  }
  const campoCnpj = await localizarPrimeiro(page, [env.mteCnpjSelector, 'input[name="nrCnpjSindicatoLaboral"]'], 'CNPJ');
  await campoCnpj.fill(cnpj);
  await selecionarOpcaoPorTexto(page, env.mteTypeSelector, env.mteTypeLabel, 'tipo do instrumento');
  await selecionarOpcaoPorTexto(page, env.mteValiditySelector, env.mteValidityLabel, 'vigencia');

  const botaoPesquisar = await localizarPrimeiro(page, [env.mteSearchSelector, 'input[type="submit"][value*="Pesquisar"]', 'button:has-text("Pesquisar")', 'a:has-text("Pesquisar")'], 'pesquisa');
  await botaoPesquisar.click();
  await page.waitForSelector([env.mteResultSelector, 'table.tabelaResultados', '#tabelaResultados'].join(', '), { state: 'visible', timeout: env.mteNavigationTimeoutMs });
  const popup = context.waitForEvent('page', { timeout: 10_000 }).catch(() => null);
  const resultado = await localizarPrimeiro(page, [env.mteResultLinkSelector, 'table.tabelaResultados tbody tr:first-child a'], 'resultado da CCT');
  await resultado.click();
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
  return { texto, pdf: pdfBuffer, fonteUrl };
}

export async function listarCnpjsCacheados(): Promise<Array<{ cnpjSindicato: string; anoVigencia: number }>> {
  return prisma.convencaoColetiva.findMany({
    select: { cnpjSindicato: true, anoVigencia: true },
    orderBy: { dataAtualizacao: 'asc' }
  });
}