import { GRAUS_ENQUADRAMENTO, type GrauEnquadramento } from './enquadramentoStatus';

export const EMPRESA_HEADERS = [
  'CNPJ', 'Razão Social', 'Nome Fantasia', 'CNAE Principal', 'Descrição CNAE', 'CNAEs Secundários',
  'UF', 'Município', 'Funcionários', 'Porte', 'Sindicato na Folha',
  'CNPJ Sindicato Laboral', 'CNPJ Sindicato Patronal', 'Grau'
] as const;

export const SINDICATO_HEADERS = [
  'CNPJ', 'Nome do Sindicato', 'UF', 'Município', 'Categoria', 'Código Sindical', 'Base Territorial', 'Status de Monitorização'
] as const;

export type EmpresaPlanilha = {
  linha: number;
  cnpj: string;
  razaoSocial: string;
  nomeFantasia?: string;
  cnaePrincipal: string;
  descricaoCnae?: string;
  cnaesSecundarios: string[];
  uf: string;
  cidade: string;
  quantidadeFuncionarios?: number;
  porte?: string;
  sindicatoFolha?: string;
  cnpjSindicatoLaboral?: string;
  cnpjSindicatoPatronal?: string;
  grau?: GrauEnquadramento;
};

export type SindicatoPlanilha = {
  linha: number;
  cnpj: string;
  razaoSocial: string;
  uf: string;
  cidade?: string;
  segmento?: string;
  codigoSindical?: string;
  baseTerritorial: string[];
  ativo: boolean;
};

export type LinhaRejeitada = { aba: string; linha: number; motivo: string };

type Resultado<T> = { registros: T[]; rejeitadas: LinhaRejeitada[] };
type Linha = { numero: number; campo: (header: string) => string };

function normalizarTexto(valor: string): string {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, '');
}

function lista(valor: string): string[] {
  return valor.split(/[;,\n]/).map(item => item.trim()).filter(Boolean);
}

function opcional(valor: string): string | undefined {
  return valor.trim() || undefined;
}

function cnpjValido(valor: string, rotulo: string): string {
  const digitos = somenteDigitos(valor);
  if (digitos.length !== 14) throw new Error(`${rotulo} deve ter 14 dígitos (recebido: "${valor}").`);
  return digitos;
}

function cnaeValido(valor: string): string {
  const digitos = somenteDigitos(valor);
  if (digitos.length !== 7) throw new Error(`CNAE deve ter 7 dígitos (recebido: "${valor}").`);
  return digitos;
}

function lerLinhas(aba: string, valores: string[][] | undefined, obrigatorios: readonly string[]): { linhas: Linha[]; rejeitadas: LinhaRejeitada[] } {
  const [cabecalho, ...dados] = valores ?? [];
  const indices = new Map((cabecalho ?? []).map((header, index) => [normalizarTexto(String(header)), index]));
  const ausentes = obrigatorios.filter(header => !indices.has(normalizarTexto(header)));
  if (!cabecalho || ausentes.length > 0) {
    const motivo = !cabecalho ? 'Cabeçalho não preenchido.' : `Cabeçalho sem as colunas: ${ausentes.join(', ')}.`;
    return { linhas: [], rejeitadas: dados.length > 0 || !cabecalho ? [{ aba, linha: 1, motivo }] : [] };
  }

  const linhas = dados
    .map((celulas, index) => ({ celulas: celulas.map(celula => String(celula ?? '')), numero: index + 2 }))
    .filter(({ celulas }) => celulas.some(celula => celula.trim()))
    .map(({ celulas, numero }) => ({
      numero,
      campo: (header: string) => {
        const index = indices.get(normalizarTexto(header));
        return index === undefined ? '' : (celulas[index] ?? '').trim();
      }
    }));
  return { linhas, rejeitadas: [] };
}

export function sanitizarEmpresas(valores: string[][] | undefined, aba = 'Cadastro de Empresas'): Resultado<EmpresaPlanilha> {
  const { linhas, rejeitadas } = lerLinhas(aba, valores, ['CNPJ', 'Razão Social', 'CNAE Principal', 'UF', 'Município']);
  const registros: EmpresaPlanilha[] = [];

  for (const { numero, campo } of linhas) {
    try {
      const razaoSocial = campo('Razão Social');
      const uf = campo('UF').toUpperCase();
      const cidade = campo('Município');
      if (!razaoSocial) throw new Error('Razão Social é obrigatória.');
      if (!/^[A-Z]{2}$/.test(uf)) throw new Error(`UF inválida: "${campo('UF')}".`);
      if (!cidade) throw new Error('Município é obrigatório.');

      const funcionarios = campo('Funcionários').replace(/[.\s]/g, '');
      if (funcionarios && !/^\d+$/.test(funcionarios)) {
        throw new Error(`Funcionários deve ser um número inteiro (recebido: "${campo('Funcionários')}").`);
      }
      const grauTexto = normalizarTexto(campo('Grau')).toUpperCase();
      if (grauTexto && !(GRAUS_ENQUADRAMENTO as readonly string[]).includes(grauTexto)) {
        throw new Error(`Grau deve ser Direto, Preponderante ou Diferenciado (recebido: "${campo('Grau')}").`);
      }
      const laboral = campo('CNPJ Sindicato Laboral');
      const patronal = campo('CNPJ Sindicato Patronal');

      registros.push({
        linha: numero,
        cnpj: cnpjValido(campo('CNPJ'), 'CNPJ da empresa'),
        razaoSocial,
        nomeFantasia: opcional(campo('Nome Fantasia')),
        cnaePrincipal: cnaeValido(campo('CNAE Principal')),
        descricaoCnae: opcional(campo('Descrição CNAE')),
        cnaesSecundarios: lista(campo('CNAEs Secundários')).map(cnaeValido),
        uf,
        cidade,
        quantidadeFuncionarios: funcionarios ? Number(funcionarios) : undefined,
        porte: opcional(campo('Porte')),
        sindicatoFolha: opcional(campo('Sindicato na Folha')),
        cnpjSindicatoLaboral: laboral ? cnpjValido(laboral, 'CNPJ do sindicato laboral') : undefined,
        cnpjSindicatoPatronal: patronal ? cnpjValido(patronal, 'CNPJ do sindicato patronal') : undefined,
        grau: grauTexto ? grauTexto as GrauEnquadramento : undefined
      });
    } catch (error) {
      rejeitadas.push({ aba, linha: numero, motivo: error instanceof Error ? error.message : String(error) });
    }
  }
  return { registros, rejeitadas };
}

export function sanitizarSindicatos(valores: string[][] | undefined, aba = 'Cadastro de Sindicatos'): Resultado<SindicatoPlanilha> {
  const { linhas, rejeitadas } = lerLinhas(aba, valores, ['CNPJ', 'Nome do Sindicato', 'UF']);
  const registros: SindicatoPlanilha[] = [];

  for (const { numero, campo } of linhas) {
    try {
      const razaoSocial = campo('Nome do Sindicato');
      const uf = campo('UF').toUpperCase();
      if (!razaoSocial) throw new Error('Nome do Sindicato é obrigatório.');
      if (!/^[A-Z]{2}$/.test(uf)) throw new Error(`UF inválida: "${campo('UF')}".`);

      const status = normalizarTexto(campo('Status de Monitorização')).toUpperCase() || 'ATIVO';
      if (status !== 'ATIVO' && status !== 'INATIVO') {
        throw new Error(`Status de Monitorização deve ser ATIVO ou INATIVO (recebido: "${campo('Status de Monitorização')}").`);
      }

      registros.push({
        linha: numero,
        cnpj: cnpjValido(campo('CNPJ'), 'CNPJ do sindicato'),
        razaoSocial,
        uf,
        cidade: opcional(campo('Município')),
        segmento: opcional(campo('Categoria')),
        codigoSindical: opcional(campo('Código Sindical')),
        baseTerritorial: lista(campo('Base Territorial')),
        ativo: status === 'ATIVO'
      });
    } catch (error) {
      rejeitadas.push({ aba, linha: numero, motivo: error instanceof Error ? error.message : String(error) });
    }
  }
  return { registros, rejeitadas };
}
