import crypto from 'node:crypto';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';

export type RegistroClienteImportado = {
  [chave: string]: string;
};

const COLUNAS_REQUERIDAS = ['NUMERO_EMPRESA', 'NOME', 'CNPJ', 'CNAE', 'UF', 'CIDADE'] as const;
const XLSX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function calcularHash(arquivo: Buffer): string {
  return crypto.createHash('sha256').update(arquivo).digest('hex');
}

function validarMagicBytesXlsx(arquivo: Buffer): void {
  if (arquivo.length < XLSX_MAGIC.length || !arquivo.subarray(0, XLSX_MAGIC.length).equals(XLSX_MAGIC)) {
    throw new Error('Arquivo XLSX rejeitado: assinatura PK\\x03\\x04 não encontrada.');
  }
}

function validarBytesCsv(csvTexto: string): Buffer {
  const arquivo = Buffer.from(csvTexto, 'utf8');
  if (arquivo.includes(0)) {
    throw new Error('Arquivo CSV rejeitado: conteúdo binário detectado.');
  }
  return arquivo;
}

function limparTexto(valor: unknown): string {
  return String(valor ?? '').trim();
}

function normalizarCabecalho(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function extrairValor(registro: Record<string, string>, chave: string): string {
  const chaveNormalizada = normalizarCabecalho(chave);
  const alternativas = [
    chaveNormalizada,
    chaveNormalizada.replace(/^NUMERO_/, 'CODIGO_'),
    chaveNormalizada.replace(/^CNPJ$/, 'CNPJ')
  ];

  for (const alternativa of alternativas) {
    const valor = registro[alternativa];
    if (valor !== undefined && valor !== null && limparTexto(valor) !== '') {
      return limparTexto(valor);
    }
  }

  const chaves = Object.keys(registro);
  const direta = chaves.find(chaveAtual => normalizarCabecalho(chaveAtual) === chaveNormalizada);
  return direta ? limparTexto(registro[direta]) : '';
}

function detectarDelimitador(cabecalho: string): string {
  return cabecalho.includes(';') ? ';' : ',';
}

function parseCsv(texto: string): Record<string, string>[] {
  if (!texto.trim()) {
    return [];
  }

  const linhas = texto.split(/\r?\n/).filter(linha => linha.trim() !== '');
  const cabecalho = linhas[0] ?? '';
  const registros = parse(texto, {
    bom: true,
    delimiter: detectarDelimitador(cabecalho),
    columns: true,
    trim: true,
    skip_empty_lines: true,
    relax_column_count: true,
    cast: false
  }) as Array<Record<string, string>>;

  return registros.map(registro => {
    const normalizado: Record<string, string> = {};
    for (const [chave, valor] of Object.entries(registro)) {
      normalizado[normalizarCabecalho(chave)] = limparTexto(valor);
    }
    return normalizado;
  });
}

function normalizarCnpj(valor: string): string {
  return valor.replace(/\D/g, '');
}

function normalizarUf(valor: string): string {
  return valor.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
}

function validarLinha(registro: Record<string, string>): { valido: boolean; mensagem?: string; dados: Record<string, string> } {
  const dados = { ...registro };
  const numeroEmpresa = extrairValor(dados, 'NUMERO_EMPRESA') || extrairValor(dados, 'CODIGO_ERP');
  const nome = extrairValor(dados, 'NOME') || extrairValor(dados, 'RAZAO_SOCIAL') || extrairValor(dados, 'NOME_EMPRESA');
  const cnpj = normalizarCnpj(extrairValor(dados, 'CNPJ'));
  const cnae = extrairValor(dados, 'CNAE').replace(/\D/g, '').slice(0, 7);
  const uf = normalizarUf(extrairValor(dados, 'UF'));
  const cidade = extrairValor(dados, 'CIDADE');

  const faltantes = COLUNAS_REQUERIDAS.filter(chave => {
    const valor = extrairValor(dados, chave);
    return !valor || (chave === 'CNPJ' && !normalizarCnpj(valor));
  });

  if (faltantes.length > 0) {
    return {
      valido: false,
      mensagem: `Campos obrigatórios ausentes: ${faltantes.join(', ')}`,
      dados: {
        ...dados,
        NUMERO_EMPRESA: numeroEmpresa,
        NOME: nome,
        CNPJ: cnpj,
        CNAE: cnae,
        UF: uf,
        CIDADE: cidade
      }
    };
  }

  if (cnpj.length !== 14) {
    return {
      valido: false,
      mensagem: 'CNPJ inválido: deve conter 14 dígitos.',
      dados: {
        ...dados,
        NUMERO_EMPRESA: numeroEmpresa,
        NOME: nome,
        CNPJ: cnpj,
        CNAE: cnae,
        UF: uf,
        CIDADE: cidade
      }
    };
  }

  return {
    valido: true,
    dados: {
      ...dados,
      NUMERO_EMPRESA: numeroEmpresa,
      NOME: nome,
      CNPJ: cnpj,
      CNAE: cnae,
      UF: uf,
      CIDADE: cidade
    }
  };
}

export async function importarClientesCsv(csvTexto: string, nomeArquivo = 'clientes.csv', hashArquivo = calcularHash(validarBytesCsv(csvTexto))) {
  const registros = parseCsv(csvTexto);

  if (registros.length === 0) {
    throw new Error('O CSV está vazio ou não possui cabeçalho válido.');
  }

  const faltantes = COLUNAS_REQUERIDAS.filter(chave => {
    const encontrados = Object.keys(registros[0] ?? {}).some(chaveAtual => normalizarCabecalho(chaveAtual) === normalizarCabecalho(chave));
    return !encontrados;
  });

  if (faltantes.length > 0) {
    throw new Error(`CSV sem colunas obrigatórias: ${faltantes.join(', ')}`);
  }

  const existente = await prisma.importacaoLote.findFirst({
    where: { tipo: 'CLIENTES', hashArquivo },
    select: { id: true, status: true, nomeArquivo: true, processadas: true, invalidas: true, totalLinhas: true }
  });
  if (existente) {
    return {
      duplicado: true,
      aviso: 'Arquivo já importado anteriormente; nenhum dado foi processado novamente.',
      loteId: existente.id,
      status: existente.status,
      totalLinhas: existente.totalLinhas,
      processadas: existente.processadas,
      invalidas: existente.invalidas,
      nomeArquivo: existente.nomeArquivo,
      hashArquivo
    };
  }

  const loteAtualizado = await prisma.$transaction(async tx => {
    const lote = await tx.importacaoLote.create({
      data: {
        nomeArquivo,
        hashArquivo,
        tipo: 'CLIENTES',
        status: 'PROCESSANDO',
        totalLinhas: registros.length,
        processadas: 0,
        invalidas: 0
      }
    });

    let processadas = 0;
    let invalidas = 0;

    for (let indice = 0; indice < registros.length; indice += 1) {
      const linha = registros[indice];
      const validacao = validarLinha(linha);
      const numeroLinha = indice + 2;

      if (!validacao.valido) {
        invalidas += 1;
        await tx.importacaoLinha.create({
          data: {
            loteId: lote.id,
            numeroLinha,
            status: 'INVALIDA',
            mensagem: validacao.mensagem,
            dadosJson: JSON.stringify(validacao.dados)
          }
        });
        continue;
      }

      const dados = validacao.dados;
      const cliente = await tx.cliente.upsert({
        where: { cnpj: dados.CNPJ },
        update: {
          codigoErp: dados.NUMERO_EMPRESA || undefined,
          razaoSocial: dados.NOME,
          cnaePrincipal: dados.CNAE,
          uf: dados.UF,
          cidade: dados.CIDADE,
          descricaoCnae: ''
        },
        create: {
          cnpj: dados.CNPJ,
          codigoErp: dados.NUMERO_EMPRESA || null,
          razaoSocial: dados.NOME,
          cnaePrincipal: dados.CNAE,
          descricaoCnae: '',
          uf: dados.UF,
          cidade: dados.CIDADE
        }
      });

      processadas += 1;
      await tx.importacaoLinha.create({
        data: {
          loteId: lote.id,
          numeroLinha,
          status: 'PROCESSADA',
          mensagem: 'Cliente validado e persistido.',
          dadosJson: JSON.stringify(dados),
          clienteId: cliente.id
        }
      });
    }

    return tx.importacaoLote.update({
      where: { id: lote.id },
      data: {
        status: invalidas > 0 ? 'COM_ERROS' : 'CONCLUIDO',
        totalLinhas: registros.length,
        processadas,
        invalidas,
        finalizadoEm: new Date()
      }
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return {
    loteId: loteAtualizado.id,
    status: loteAtualizado.status,
    totalLinhas: registros.length,
    processadas: loteAtualizado.processadas,
    invalidas: loteAtualizado.invalidas,
    nomeArquivo: loteAtualizado.nomeArquivo,
    hashArquivo: loteAtualizado.hashArquivo,
    duplicado: false
  };
}

export async function importarClientesXlsx(arquivo: Buffer, nomeArquivo = 'clientes.xlsx') {
  if (arquivo.length === 0) {
    throw new Error('O arquivo Excel está vazio.');
  }
  validarMagicBytesXlsx(arquivo);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arquivo as any);
  const planilha = workbook.worksheets[0];
  if (!planilha) {
    throw new Error('A planilha Excel não possui abas.');
  }

  const valorTexto = (valor: ExcelJS.CellValue): string => {
    if (valor === null || valor === undefined) return '';
    if (typeof valor === 'object' && 'result' in valor) return limparTexto(valor.result);
    if (typeof valor === 'object' && 'text' in valor) return limparTexto(valor.text);
    return limparTexto(valor);
  };
  const escaparCsv = (valor: string): string => /[",\n\r]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
  const linhas: string[] = [];
  planilha.eachRow({ includeEmpty: false }, row => {
    const valores = (row.values as ExcelJS.CellValue[]).slice(1).map(valor => escaparCsv(valorTexto(valor)));
    linhas.push(valores.join(','));
  });
  const csvTexto = linhas.join('\n');
  return importarClientesCsv(csvTexto, nomeArquivo, calcularHash(arquivo));
}
