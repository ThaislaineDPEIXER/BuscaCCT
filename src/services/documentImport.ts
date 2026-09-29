import * as XLS from '@e965/xlsx';
import { parse as parseCsv } from 'csv-parse/sync';
import {
  EMPRESA_HEADERS,
  SINDICATO_HEADERS,
  sanitizarEmpresas,
  sanitizarSindicatos,
  type EmpresaPlanilha,
  type SindicatoPlanilha
} from './adminSheetParser';
import { lerDocumentoComIa, type MimeSuportado } from './aiDocumentReader';

type EmpresaExtraida = {
  codigo_empresa?: string | null;
  cnpj?: string | null;
  razao_social?: string | null;
  cnae_principal?: string | null;
  descricao_cnae?: string | null;
  uf?: string | null;
  municipio?: string | null;
  sindicato_na_folha?: string | null;
  cct_registro?: string | null;
};

type SindicatoExtraido = {
  cnpj?: string | null;
  nome?: string | null;
  uf?: string | null;
  municipio?: string | null;
  categoria?: string | null;
  codigo_sindical?: string | null;
  base_territorial?: string[] | null;
};

export type ExtracaoCadastros = { empresas: EmpresaExtraida[]; sindicatos: SindicatoExtraido[] };

export type LinhasImportacao = {
  empresas: string[][];
  sindicatos: string[][];
  rejeitadas: string[];
  duplicadas: number;
};

function normalizarCabecalho(valor: string): string {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

const CAMPOS_OBRIGATORIOS = ['CNPJ', 'Nome do Sindicato', 'UF'];

// Linha com mais células preenchidas no topo da aba: provável cabeçalho, mostrado no erro para ajustar o mapeamento.
function resumirCabecalho(nome: string, valores: (string | number)[][]): string {
  const candidata = valores.slice(0, 30)
    .map((linha, indice) => ({ indice, celulas: linha.map(celula => String(celula).trim()).filter(Boolean) }))
    .sort((a, b) => b.celulas.length - a.celulas.length)[0];
  if (!candidata || candidata.celulas.length === 0) return `aba "${nome}" vazia`;
  const celulas = candidata.celulas.slice(0, 15).map(celula => celula.slice(0, 40));
  return `aba "${nome}" linha ${candidata.indice + 1}: ${celulas.join(' | ')}`;
}

const COLUNAS_SINDICATO: Record<string, string[]> = {
  CNPJ: ['cnpj', 'cnpj sindicato', 'cnpj do sindicato', 'cnpj da entidade'],
  'Nome do Sindicato': ['nome do sindicato', 'nome sindicato', 'sindicato', 'razao social', 'nome', 'nome da entidade', 'entidade sindical'],
  UF: ['uf', 'estado', 'sigla uf'],
  'Município': ['municipio', 'cidade'],
  Categoria: ['categoria', 'segmento'],
  'Código Sindical': ['codigo sindical'],
  'Base Territorial': ['base territorial'],
  'Status de Monitorização': ['status de monitorizacao', 'status']
};

const ESTADOS: Record<string, string> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE', 'distrito federal': 'DF',
  'espirito santo': 'ES', goias: 'GO', maranhao: 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
  'minas gerais': 'MG', para: 'PA', paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI',
  'rio de janeiro': 'RJ', 'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO',
  roraima: 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO'
};
const SIGLAS_UF = new Set(Object.values(ESTADOS));

function ufDe(valor: string): string | undefined {
  const texto = valor.trim();
  if (texto.length === 2 && SIGLAS_UF.has(texto.toUpperCase())) return texto.toUpperCase();
  return ESTADOS[normalizarCabecalho(texto)];
}

const ROTULOS_RELATORIO: Record<string, 'codigo' | 'apelido' | 'nome' | 'cnpj' | 'cidade' | 'uf'> = {
  codigo: 'codigo', apelido: 'apelido', nome: 'nome', cnpj: 'cnpj', cidade: 'cidade', municipio: 'cidade', uf: 'uf', estado: 'uf'
};

type RegistroRelatorio = Partial<Record<'codigo' | 'apelido' | 'nome' | 'cnpj' | 'cidade' | 'uf', string>> & { linha: number };

const ehRotulo = (celula: string) => /:\s*$/.test(celula);

// Relatório de ERP (ex.: Domínio): um bloco por sindicato, iniciado por "Código:", com o valor à direita de cada rótulo.
export function lerRelatorioSindical(valores: (string | number)[][]): { linhas: string[][]; numeros: number[] } {
  const celulas = valores.map(linha => linha.map(celula => String(celula ?? '').trim()));
  const valorDe = (r: number, c: number): string => {
    const direita = celulas[r].slice(c + 1).find(Boolean) ?? '';
    if (direita && !ehRotulo(direita)) return direita;
    const abaixo = celulas[r + 1]?.[c] ?? '';
    return abaixo && !ehRotulo(abaixo) ? abaixo : '';
  };
  const registros: RegistroRelatorio[] = [];
  let atual: RegistroRelatorio | undefined;

  celulas.forEach((linha, r) => linha.forEach((celula, c) => {
    if (!ehRotulo(celula)) return;
    const campo = ROTULOS_RELATORIO[normalizarCabecalho(celula)];
    if (campo === 'codigo') registros.push(atual = { linha: r + 1 });
    if (!campo || !atual) return;
    const valor = valorDe(r, c);
    if (campo === 'uf') {
      atual.uf ??= ufDe(valor);
    } else if (campo === 'cidade') {
      const [, cidade, sigla] = valor.match(/^(.*?)\s*[-/]\s*([A-Za-z]{2})$/) ?? [];
      const soEstado = valor.length > 2 && Boolean(ufDe(valor));
      atual.cidade ??= soEstado ? undefined : (sigla && ufDe(sigla) ? cidade : valor) || undefined;
      atual.uf ??= (sigla && ufDe(sigla)) || linha.slice(c + 1).map(ufDe).find(Boolean);
    } else if (valor) {
      atual[campo] ??= valor;
    }
  }));

  return {
    linhas: registros.map(registro => SINDICATO_HEADERS.map(header => ({
      CNPJ: registro.cnpj ?? '',
      'Nome do Sindicato': registro.nome ?? registro.apelido ?? '',
      UF: registro.uf ?? '',
      'Município': registro.cidade ?? '',
      'Código Sindical': registro.codigo ?? ''
    } as Record<string, string>)[header] ?? '')),
    numeros: registros.map(registro => registro.linha)
  };
}

function validarLinhasSindicais(
  linhas: string[][],
  numeros: number[],
  existentes: { empresas: Set<string>; sindicatos: Set<string> },
  origem: string
): LinhasImportacao {
  const resultado: LinhasImportacao = { empresas: [], sindicatos: [], rejeitadas: [], duplicadas: 0 };
  const validacao = sanitizarSindicatos([SINDICATO_HEADERS.slice(), ...linhas], origem);
  resultado.rejeitadas.push(...validacao.rejeitadas.map(item => `${origem}: item ${numeros[item.linha - 2] ?? item.linha} rejeitado (${item.motivo})`));
  const vistos = new Set(existentes.sindicatos);
  for (const sindicato of validacao.registros) {
    if (vistos.has(sindicato.cnpj)) {
      resultado.duplicadas++;
    } else {
      vistos.add(sindicato.cnpj);
      resultado.sindicatos.push(linhaSindicato(sindicato));
    }
  }
  if (resultado.sindicatos.length === 0 && resultado.duplicadas === 0) {
    throw new Error(`${origem}: nenhum sindicato válido encontrado. ${resultado.rejeitadas.slice(0, 3).join('; ')}`);
  }
  return resultado;
}

// Diagnóstico técnico para quando a biblioteca não devolve o conteúdo das abas.
function diagnosticarArquivo(arquivo: Buffer, workbook: XLS.WorkBook): string {
  let erroEstrito = 'nenhum';
  try {
    XLS.read(arquivo, { type: 'buffer', WTF: true });
  } catch (error) {
    erroEstrito = (error instanceof Error ? error.message : String(error)).slice(0, 200);
  }
  return [
    `formato ${workbook.bookType ?? 'desconhecido'}`,
    `assinatura ${arquivo.subarray(0, 8).toString('hex')}`,
    `abas listadas [${workbook.SheetNames.join(', ')}]`,
    `abas lidas [${Object.keys(workbook.Sheets ?? {}).join(', ')}]`,
    `erro de leitura: ${erroEstrito}`
  ].join('; ');
}

export function lerCadastroSindicalExcel(
  arquivo: Buffer,
  existentes: { empresas: Set<string>; sindicatos: Set<string> },
  origem: string
): LinhasImportacao {
  const workbook = XLS.read(arquivo, { type: 'buffer', cellDates: false });
  const encontrados: string[] = [];
  const lidas = workbook.Sheets ?? {};
  // Algumas exportações de ERP gravam o nome da aba diferente da chave em Sheets; usa ambas.
  const nomes = [...new Set([...workbook.SheetNames.filter(nome => lidas[nome]), ...Object.keys(lidas)])];
  for (const nome of nomes) {
    const aba = lidas[nome];
    if (!aba) continue;
    if (aba['!ref'] && XLS.utils.decode_range(aba['!ref']).e.r >= 50_000) {
      throw new Error(`${origem}: aba "${nome}" excede 50.000 linhas; divida o arquivo antes de importar.`);
    }
    const valores = XLS.utils.sheet_to_json<(string | number)[]>(aba, { header: 1, raw: false, defval: '' });
    const indice = valores.findIndex(linha => {
      const nomes = new Set(linha.map(celula => normalizarCabecalho(String(celula))));
      return CAMPOS_OBRIGATORIOS.every(campo => COLUNAS_SINDICATO[campo].some(alias => nomes.has(alias)));
    });
    if (indice < 0) {
      const relatorio = lerRelatorioSindical(valores);
      if (relatorio.linhas.length > 0) return validarLinhasSindicais(relatorio.linhas, relatorio.numeros, existentes, origem);
      encontrados.push(resumirCabecalho(nome, valores));
      continue;
    }
    const cabecalho = valores[indice].map(celula => normalizarCabecalho(String(celula)));
    const colunas = SINDICATO_HEADERS.map(header => cabecalho.findIndex(celula => COLUNAS_SINDICATO[header]?.includes(celula)));
    const linhas = valores.slice(indice + 1).map(linha => colunas.map(coluna => coluna < 0 ? '' : String(linha[coluna] ?? '')));
    if (linhas.length === 0) throw new Error(`${origem}: a planilha não contém cadastros abaixo do cabeçalho.`);
    return validarLinhasSindicais(linhas, linhas.map((_, i) => indice + 2 + i), existentes, origem);
  }
  const detalhe = encontrados.length > 0 ? `Cabeçalhos encontrados: ${encontrados.join('; ')}` : `Nenhuma aba legível (${diagnosticarArquivo(arquivo, workbook)})`;
  throw new Error(`${origem}: nenhuma aba possui as colunas CNPJ, Nome do Sindicato e UF nem blocos "Código:" de relatório. ${detalhe}.`);
}

export function lerCadastroSindicalCsv(
  arquivo: Buffer,
  existentes: { empresas: Set<string>; sindicatos: Set<string> },
  origem: string
): LinhasImportacao {
  const texto = new TextDecoder('windows-1252').decode(arquivo).replace(/^\uFEFF/, '');
  const candidatos = [',', ';', '\t'].flatMap(delimiter => {
    try {
      const valores = parseCsv(texto, { delimiter, relax_column_count: true, relax_quotes: true, skip_empty_lines: false, bom: true }) as string[][];
      const blocos = valores.filter(linha => normalizarCabecalho(linha.find(celula => celula.trim()) ?? '') === 'codigo').length;
      return [{ valores, blocos }];
    } catch {
      return [];
    }
  }).sort((a, b) => b.blocos - a.blocos);

  const melhor = candidatos[0];
  if (!melhor || melhor.blocos === 0) {
    throw new Error(`${origem}: CSV inválido ou sem blocos "Código:" do relatório sindical.`);
  }
  const relatorio = lerRelatorioSindical(melhor.valores);
  return validarLinhasSindicais(relatorio.linhas, relatorio.numeros, existentes, origem);
}

export const SYSTEM_PROMPT_CADASTROS = `Você extrai dados cadastrais de documentos brasileiros (cartão CNPJ, contrato social, listas de clientes, cadastros sindicais, CCTs).
Retorne ÚNICA e EXCLUSIVAMENTE um objeto JSON válido, sem Markdown, neste formato:
{
  "empresas": [{ "codigo_empresa": null, "cnpj": "", "razao_social": "", "cnae_principal": "", "descricao_cnae": null, "uf": "", "municipio": "", "sindicato_na_folha": null, "cct_registro": null }],
  "sindicatos": [{ "cnpj": "", "nome": "", "uf": "", "municipio": null, "categoria": null, "codigo_sindical": null, "base_territorial": [] }]
}
Regras:
1. Use somente dados escritos no documento. Nunca invente, complete ou deduza CNPJ, CNAE, UF ou município; se não estiver escrito, use null.
2. "empresas" são empresas empregadoras; "sindicatos" são entidades sindicais (laborais ou patronais). Não classifique uma empresa como sindicato nem o contrário.
3. Não indique qual sindicato representa qual empresa. O enquadramento sindical é decidido pela equipe de DP.
4. "cct_registro" é o número de registro da convenção no MTE (ex.: SC000123/2026), apenas se estiver escrito.
5. Se o documento não contiver empresas ou sindicatos, retorne listas vazias.`;

function textoOuVazio(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

export function interpretarExtracao(resposta: string): ExtracaoCadastros {
  let bruto: unknown;
  try {
    bruto = JSON.parse(resposta.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
  } catch {
    throw new Error('A IA não retornou JSON válido para o documento.');
  }
  const dados = bruto as Partial<ExtracaoCadastros> | null;
  if (!dados || typeof dados !== 'object' || !Array.isArray(dados.empresas) || !Array.isArray(dados.sindicatos)) {
    throw new Error('A resposta da IA está fora do formato esperado (empresas/sindicatos).');
  }
  return {
    empresas: dados.empresas.filter(item => item && typeof item === 'object'),
    sindicatos: dados.sindicatos.filter(item => item && typeof item === 'object')
  };
}

function linhaEmpresa(empresa: EmpresaPlanilha): string[] {
  const valores: Record<typeof EMPRESA_HEADERS[number], string> = {
    'Código da Empresa': empresa.codigoErp ?? '',
    CNPJ: empresa.cnpj,
    'Razão Social': empresa.razaoSocial,
    'CNAE Principal': empresa.cnaePrincipal,
    'Descrição CNAE': empresa.descricaoCnae ?? '',
    UF: empresa.uf,
    Município: empresa.cidade,
    'Sindicato na Folha': empresa.sindicatoFolha ?? '',
    'CCT (Registro MTE)': empresa.cctRegistro ?? '',
    'CNPJ Sindicato Laboral': '',
    'CNPJ Sindicato Patronal': ''
  };
  return EMPRESA_HEADERS.map(header => valores[header]);
}

function linhaSindicato(sindicato: SindicatoPlanilha): string[] {
  const valores: Record<typeof SINDICATO_HEADERS[number], string> = {
    CNPJ: sindicato.cnpj,
    'Nome do Sindicato': sindicato.razaoSocial,
    UF: sindicato.uf,
    Município: sindicato.cidade ?? '',
    Categoria: sindicato.segmento ?? '',
    'Código Sindical': sindicato.codigoSindical ?? '',
    'Base Territorial': sindicato.baseTerritorial.join(', '),
    'Status de Monitorização': sindicato.ativo ? 'ATIVO' : 'INATIVO'
  };
  return SINDICATO_HEADERS.map(header => valores[header]);
}

export function montarLinhasImportacao(
  extracao: ExtracaoCadastros,
  existentes: { empresas: Set<string>; sindicatos: Set<string> },
  origem: string
): LinhasImportacao {
  const empresasBrutas = extracao.empresas.map(item => {
    const valores: Partial<Record<typeof EMPRESA_HEADERS[number], string>> = {
      'Código da Empresa': textoOuVazio(item.codigo_empresa),
      CNPJ: textoOuVazio(item.cnpj),
      'Razão Social': textoOuVazio(item.razao_social),
      'CNAE Principal': textoOuVazio(item.cnae_principal),
      'Descrição CNAE': textoOuVazio(item.descricao_cnae),
      UF: textoOuVazio(item.uf),
      Município: textoOuVazio(item.municipio),
      'Sindicato na Folha': textoOuVazio(item.sindicato_na_folha),
      'CCT (Registro MTE)': textoOuVazio(item.cct_registro)
    };
    return EMPRESA_HEADERS.map(header => valores[header] ?? '');
  });
  const sindicatosBrutos = extracao.sindicatos.map(item => {
    const valores: Partial<Record<typeof SINDICATO_HEADERS[number], string>> = {
      CNPJ: textoOuVazio(item.cnpj),
      'Nome do Sindicato': textoOuVazio(item.nome),
      UF: textoOuVazio(item.uf),
      Município: textoOuVazio(item.municipio),
      Categoria: textoOuVazio(item.categoria),
      'Código Sindical': textoOuVazio(item.codigo_sindical),
      'Base Territorial': Array.isArray(item.base_territorial) ? item.base_territorial.map(textoOuVazio).filter(Boolean).join(', ') : ''
    };
    return SINDICATO_HEADERS.map(header => valores[header] ?? '');
  });

  const empresas = sanitizarEmpresas([[...EMPRESA_HEADERS], ...empresasBrutas], origem);
  const sindicatos = sanitizarSindicatos([[...SINDICATO_HEADERS], ...sindicatosBrutos], origem);
  const resultado: LinhasImportacao = {
    empresas: [],
    sindicatos: [],
    rejeitadas: [...empresas.rejeitadas, ...sindicatos.rejeitadas].map(item => `${origem}: item ${item.linha - 1} rejeitado (${item.motivo})`),
    duplicadas: 0
  };

  const vistasEmpresas = new Set(existentes.empresas);
  for (const empresa of empresas.registros) {
    if (vistasEmpresas.has(empresa.cnpj)) {
      resultado.duplicadas += 1;
      continue;
    }
    vistasEmpresas.add(empresa.cnpj);
    resultado.empresas.push(linhaEmpresa(empresa));
  }

  const vistosSindicatos = new Set(existentes.sindicatos);
  for (const sindicato of sindicatos.registros) {
    if (vistosSindicatos.has(sindicato.cnpj)) {
      resultado.duplicadas += 1;
      continue;
    }
    vistosSindicatos.add(sindicato.cnpj);
    resultado.sindicatos.push(linhaSindicato(sindicato));
  }
  return resultado;
}

export async function extrairCadastrosDeDocumento(documento: Buffer, mimeType: MimeSuportado): Promise<ExtracaoCadastros> {
  const resposta = await lerDocumentoComIa(documento, mimeType, {
    systemPrompt: SYSTEM_PROMPT_CADASTROS,
    instrucao: 'Extraia as empresas e os sindicatos presentes neste documento.',
    json: true,
    maxTokens: 8_000
  });
  return interpretarExtracao(resposta);
}
