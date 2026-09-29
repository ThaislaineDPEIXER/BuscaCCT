export const EMPRESA_HEADERS = [
  'Código da Empresa', 'CNPJ', 'Razão Social', 'CNAE Principal', 'Descrição CNAE',
  'UF', 'Município', 'Sindicato na Folha', 'CCT (Registro MTE)',
  'CNPJ Sindicato Laboral', 'CNPJ Sindicato Patronal'
] as const;

export const SINDICATO_HEADERS = [
  'CNPJ', 'Nome do Sindicato', 'UF', 'Município', 'Categoria', 'Código Sindical', 'Base Territorial', 'Status de Monitorização'
] as const;

export type EmpresaPlanilha = {
  linha: number;
  codigoErp?: string;
  cnpj: string;
  razaoSocial: string;
  cnaePrincipal: string;
  descricaoCnae?: string;
  uf: string;
  cidade: string;
  sindicatoFolha?: string;
  cctRegistro?: string;
  cnpjSindicatoLaboral?: string;
  cnpjSindicatoPatronal?: string;
  vinculoLaboralAutomatico?: boolean;
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

// Mantém as colunas da equipe e só acrescenta ao fim as esperadas que faltam; null = nada a fazer.
export function completarCabecalho(atual: string[], esperado: readonly string[]): string[] | null {
  const preenchido = atual.map(valor => String(valor ?? '').trim());
  while (preenchido.length > 0 && !preenchido[preenchido.length - 1]) preenchido.pop();
  const presentes = new Set(preenchido.map(normalizarTexto));
  const faltantes = esperado.filter(header => !presentes.has(normalizarTexto(header)));
  if (preenchido.length > 0 && faltantes.length === 0) return null;
  return [...preenchido, ...faltantes];
}

export function alinharAoCabecalho(linhas: string[][], esperado: readonly string[], cabecalhoReal: string[]): string[][] {
  const origem = new Map(esperado.map((header, index) => [normalizarTexto(header), index]));
  const destino = cabecalhoReal.map(header => origem.get(normalizarTexto(String(header ?? ''))));
  return linhas.map(linha => destino.map(index => (index === undefined ? '' : linha[index] ?? '')));
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

function registroCctValido(valor: string): string {
  const registro = valor.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{6}\/\d{4}$/.test(registro)) {
    throw new Error(`CCT deve estar no formato do registro MTE, ex.: SC000123/2026 (recebido: "${valor}").`);
  }
  return registro;
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

      const laboral = campo('CNPJ Sindicato Laboral');
      const patronal = campo('CNPJ Sindicato Patronal');
      const cct = campo('CCT (Registro MTE)');

      registros.push({
        linha: numero,
        codigoErp: opcional(campo('Código da Empresa')),
        cnpj: cnpjValido(campo('CNPJ'), 'CNPJ da empresa'),
        razaoSocial,
        cnaePrincipal: cnaeValido(campo('CNAE Principal')),
        descricaoCnae: opcional(campo('Descrição CNAE')),
        uf,
        cidade,
        sindicatoFolha: opcional(campo('Sindicato na Folha')),
        cctRegistro: cct ? registroCctValido(cct) : undefined,
        cnpjSindicatoLaboral: laboral ? cnpjValido(laboral, 'CNPJ do sindicato laboral') : undefined,
        cnpjSindicatoPatronal: patronal ? cnpjValido(patronal, 'CNPJ do sindicato patronal') : undefined
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
