import fs from 'node:fs';
import { parse } from 'csv-parse';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';

const CNAE_SINDICATO = '9420100';
const LOTE = 500;

type Colunas = string[];

function limpar(valor: string | undefined): string {
  return (valor ?? '').trim();
}

function segmentoPorNome(nome: string): string | undefined {
  if (/metalurg|textil|têxtil|industr/i.test(nome)) return 'industria';
  if (/comercio|comércio|vendas|lojist/i.test(nome)) return 'comercio';
  if (/\bti\b|informatica|informática|processamento de dados|tecnologia/i.test(nome)) return 'tecnologia';
  return undefined;
}

async function linhas(caminhoArquivo: string): Promise<AsyncIterable<Colunas>> {
  const arquivo = fs.createReadStream(caminhoArquivo, { encoding: 'latin1' });
  return arquivo.pipe(parse({
    delimiter: ';',
    quote: '"',
    escape: '"',
    relax_column_count: true,
    skip_empty_lines: true
  }));
}

async function salvarLote(lote: Prisma.SindicatoCreateInput[]): Promise<void> {
  await prisma.$transaction(lote.map(registro => prisma.sindicato.upsert({
    where: { cnpj: registro.cnpj },
    update: { cnpjBase: registro.cnpjBase, cnae: registro.cnae, uf: registro.uf, cidade: registro.cidade },
    create: registro
  })));
}

export async function processarEstabelecimentos(caminhoArquivo: string): Promise<number> {
  let encontrados = 0;
  let lote: Prisma.SindicatoCreateInput[] = [];
  for await (const colunas of await linhas(caminhoArquivo)) {
    if (limpar(colunas[11]) !== CNAE_SINDICATO) continue;
    const cnpjBase = limpar(colunas[0]).padStart(8, '0');
    const cnpj = `${cnpjBase}${limpar(colunas[1]).padStart(4, '0')}${limpar(colunas[2]).padStart(2, '0')}`;
    lote.push({ cnpj, cnpjBase, cnae: CNAE_SINDICATO, uf: limpar(colunas[19]), cidade: limpar(colunas[20]) });
    encontrados += 1;
    if (lote.length >= LOTE) {
      await salvarLote(lote);
      lote = [];
      console.info(`[RECEITA] ${encontrados} estabelecimentos sindicais processados`);
    }
  }
  if (lote.length > 0) await salvarLote(lote);
  return encontrados;
}

export async function processarEmpresas(caminhoArquivo: string): Promise<number> {
  const registros = await prisma.sindicato.findMany({ where: { cnpjBase: { not: null } }, select: { cnpjBase: true } });
  const bases = new Set(registros.map(registro => registro.cnpjBase).filter((base): base is string => Boolean(base)));
  let enriquecidos = 0;
  for await (const colunas of await linhas(caminhoArquivo)) {
    const cnpjBase = limpar(colunas[0]).padStart(8, '0');
    if (!bases.has(cnpjBase)) continue;
    const razaoSocial = limpar(colunas[1]);
    const nomeFantasia = limpar(colunas[2]) || null;
    await prisma.sindicato.updateMany({ where: { cnpjBase }, data: { razaoSocial, nomeFantasia, segmento: segmentoPorNome(`${razaoSocial} ${nomeFantasia ?? ''}`) } });
    enriquecidos += 1;
    if (enriquecidos % LOTE === 0) console.info(`[RECEITA] ${enriquecidos} empresas cruzadas`);
  }
  return enriquecidos;
}

async function main(): Promise<void> {
  const [tipo, caminho] = process.argv.slice(2);
  if (!tipo || !caminho || !['estabelecimentos', 'empresas'].includes(tipo)) {
    throw new Error('Uso: npm run receita:importar -- estabelecimentos|empresas caminho-do-arquivo.csv');
  }
  const total = tipo === 'estabelecimentos' ? await processarEstabelecimentos(caminho) : await processarEmpresas(caminho);
  console.info(`[RECEITA] Concluido: ${total} registros`);
}

if (require.main === module) {
  main().catch(error => { console.error('[RECEITA] Falha:', error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}
