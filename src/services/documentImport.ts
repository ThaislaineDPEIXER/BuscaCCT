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
    'Status de Monitorização': 'ATIVO'
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
