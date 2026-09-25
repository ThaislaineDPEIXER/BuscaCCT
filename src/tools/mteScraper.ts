import crypto from 'node:crypto';
import { BrowserContext, chromium, Page } from 'playwright';
import { prisma } from '../db';
import { env } from '../config/env';
import { criarAlertaNovaCct } from '../services/alertService';
import { extrairTextoPdfComClaude } from '../services/cctOcr';
import { storePdf } from '../services/documentStorage';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class CctUnavailableError extends Error {}
export class CctCaptchaRequiredError extends CctUnavailableError {}
export class CctAccessBlockedError extends CctUnavailableError {}

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

export async function buscarESalvarCCT(cnpj: string, anoVigencia: number): Promise<string> {
  const cnpjNormalizado = normalizarCnpj(cnpj);
  const cache = await prisma.convencaoColetiva.findUnique({
    where: { cnpjSindicato_anoVigencia: { cnpjSindicato: cnpjNormalizado, anoVigencia } }
  });
  const cacheAtual = cache && Date.now() - cache.dataAtualizacao.getTime() < CACHE_TTL_MS;
  if (cacheAtual) return cache.textoCompleto;

  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= env.mteMaxAttempts; tentativa += 1) {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
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
      if (error instanceof CctCaptchaRequiredError) break;
      if (tentativa < env.mteMaxAttempts) await wait(2_000 * tentativa);
    }
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
  if (/just a moment|verify you are human|cf-chl|cloudflare/i.test(`${titulo}\n${corpo}`)) {
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
    texto = await extrairTextoPdfComClaude(pdfBuffer);
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
