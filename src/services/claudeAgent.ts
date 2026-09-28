import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';
import { buscarESalvarCCT } from '../tools/mteScraper';
import { consultarIndice } from '../tools/ibgeApi';

const anthropic = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;
const gemini = env.geminiApiKey ? new GoogleGenerativeAI(env.geminiApiKey) : null;

export interface ExtracaoCct {
  sindicato_nome: string | null;
  data_base_mes: string | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  pisos_salariais: Array<{ cargo_ou_categoria: string; valor: number }>;
  horas_extras: Array<{ condicao: string; percentual: number }>;
  beneficios: {
    vale_refeicao_diario: number | null;
    desconto_vale_refeicao_percentual: number | null;
    quebra_de_caixa_mensal: number | null;
    anuenio_percentual: number | null;
  };
  impactos_folha: Array<{
    categoria: 'PISO_SALARIAL' | 'HORA_EXTRA' | 'BENEFICIO' | 'REAJUSTE' | 'OUTRO';
    descricao: string;
    valor_anterior: number | null;
    valor_novo: number | null;
    percentual: number | null;
    vigencia: string | null;
    evidencia: string | null;
  }>;
  contribuicoes_sindicais: Array<{
    tipo: string;
    valor_texto: string | null;
    valor_numerico: number | null;
    percentual: number | null;
    vencimento: string | null;
    obrigatoriedade: string | null;
    dados_pagamento: string | null;
    evidencia: string | null;
  }>;
  resumo_mudancas: string | null;
}

export const SYSTEM_PROMPT_EXTRACAO_CCT = `Você é um Auditor Sênior de Departamento Pessoal especializado em legislação trabalhista brasileira.
Sua única função é ler o texto bruto de uma Convenção Coletiva de Trabalho (CCT) extraída do Sistema Mediador do MTE e extrair os parâmetros financeiros exatos.

[REGRAS DE EXTRAÇÃO]
1. ZERO ALUCINAÇÃO: Baseie-se estritamente no texto fornecido. Se uma informação (como 'quebra de caixa' ou 'vale transporte') não estiver escrita no texto, retorne null. NUNCA invente ou assuma valores baseados na CLT.
2. NÚMEROS LIMPOS: Extraia valores monetários apenas como números decimais (ex: 1850.50), sem o símbolo "R$". Extraia percentuais apenas como números inteiros ou decimais (ex: 60), sem o símbolo "%".
3. FOCO NAS CLÁUSULAS: Busque os pisos salariais das categorias base (ex: faxineiro, auxiliar, vendedor, operador de caixa, piso geral), percentuais de horas extras, benefícios e contribuições.
4. EVIDÊNCIA: Cada impacto e contribuição deve conter um trecho curto e literal do documento no campo evidencia, ou null quando não houver trecho identificável.
5. NÃO CALCULE: Não derive reajustes, valores ou percentuais. Registre somente números explicitamente presentes no documento.

[FORMATO DE SAÍDA OBRIGATÓRIO]
Você deve retornar ÚNICA e EXCLUSIVAMENTE um objeto JSON válido, seguindo exatamente o schema abaixo. Não adicione nenhuma saudação, explicação, introdução ou formatação Markdown. Apenas o JSON puro.

Schema esperado:
{
  "sindicato_nome": "Nome identificado no documento ou null",
  "data_base_mes": "Mês da data-base ou null",
  "vigencia_inicio": "DD/MM/AAAA ou null",
  "vigencia_fim": "DD/MM/AAAA ou null",
  "pisos_salariais": [{ "cargo_ou_categoria": "Nome da função", "valor": 1950.00 }],
  "horas_extras": [{ "condicao": "Dias normais / Sábados", "percentual": 60 }],
  "beneficios": {
    "vale_refeicao_diario": 35.50,
    "desconto_vale_refeicao_percentual": 20,
    "quebra_de_caixa_mensal": 150.00,
    "anuenio_percentual": 1
  },
  "impactos_folha": [{
    "categoria": "PISO_SALARIAL",
    "descricao": "Piso geral da categoria",
    "valor_anterior": null,
    "valor_novo": 1950.00,
    "percentual": null,
    "vigencia": "01/01/2026",
    "evidencia": "Cláusula 3ª: o piso salarial será de R$ 1.950,00."
  }],
  "contribuicoes_sindicais": [{
    "tipo": "ASSISTENCIAL",
    "valor_texto": "1% do salário",
    "valor_numerico": null,
    "percentual": 1,
    "vencimento": "até o quinto dia útil",
    "obrigatoriedade": "conforme cláusula e direito de oposição descritos no documento",
    "dados_pagamento": null,
    "evidencia": "Cláusula 20ª: contribuição assistencial de 1%."
  }],
  "resumo_mudancas": "Um parágrafo curto, com no máximo três linhas, ou null."
}`;

const tools: Anthropic.Tool[] = [
  {
    name: 'consultar_sistema_mediador',
    description: 'Busca a Convenção Coletiva de Trabalho mais recente registrada no Sistema Mediador do MTE. A ferramenta usa cache local e só consulta o MTE quando necessário.',
    input_schema: {
      type: 'object',
      properties: {
        cnpj_sindicato_laboral: { type: 'string', description: 'CNPJ do sindicato dos trabalhadores, com apenas números.' },
        cnpj_sindicato_patronal: { type: 'string', description: 'CNPJ do sindicato patronal, com apenas números.' },
        ano_vigencia: { type: 'integer', description: 'Ano base para a busca da convenção.' }
      },
      required: ['cnpj_sindicato_laboral', 'ano_vigencia']
    }
  },
  {
    name: 'consultar_indice_ibge',
    description: 'Consulta IPCA ou INPC oficial no IBGE por periodo mensal.',
    input_schema: {
      type: 'object',
      properties: {
        indice: { type: 'string', enum: ['IPCA', 'INPC'] },
        periodoInicio: { type: 'string', description: 'Periodo inicial no formato AAAAMM.' },
        periodoFim: { type: 'string', description: 'Periodo final no formato AAAAMM.' }
      },
      required: ['indice', 'periodoInicio', 'periodoFim']
    }
  }
];

function anonimizarPergunta(pergunta: string): string {
  return pergunta
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF_ANONIMIZADO]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[EMAIL_ANONIMIZADO]')
    .replace(/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}\b/g, '[TELEFONE_ANONIMIZADO]');
}

function extrairTexto(resposta: Anthropic.Message): string {
  return resposta.content
    .filter((item): item is Anthropic.TextBlock => item.type === 'text')
    .map(item => item.text)
    .join('')
    .replace(/^```json\s*|\s*```$/g, '')
    .trim();
}

export function validarExtracaoCct(valor: unknown): ExtracaoCct {
  if (!valor || typeof valor !== 'object') throw new Error('Extracao CCT nao e um objeto JSON');
  const dados = valor as Partial<ExtracaoCct>;
  if (!Array.isArray(dados.pisos_salariais) || !Array.isArray(dados.horas_extras) || !dados.beneficios || typeof dados.beneficios !== 'object' || !Array.isArray(dados.impactos_folha) || !Array.isArray(dados.contribuicoes_sindicais)) {
    throw new Error('Extracao CCT fora do schema esperado');
  }
  for (const piso of dados.pisos_salariais) {
    if (typeof piso.cargo_ou_categoria !== 'string' || typeof piso.valor !== 'number') throw new Error('Piso salarial fora do schema');
  }
  for (const hora of dados.horas_extras) {
    if (typeof hora.condicao !== 'string' || typeof hora.percentual !== 'number') throw new Error('Hora extra fora do schema');
  }
  for (const impacto of dados.impactos_folha) {
    if (!['PISO_SALARIAL', 'HORA_EXTRA', 'BENEFICIO', 'REAJUSTE', 'OUTRO'].includes(impacto.categoria) || typeof impacto.descricao !== 'string') throw new Error('Impacto de folha fora do schema');
    for (const campo of ['valor_anterior', 'valor_novo', 'percentual'] as const) {
      if (impacto[campo] !== null && typeof impacto[campo] !== 'number') throw new Error('Valor de impacto fora do schema');
    }
  }
  for (const contribuicao of dados.contribuicoes_sindicais) {
    if (typeof contribuicao.tipo !== 'string') throw new Error('Contribuicao sindical fora do schema');
    for (const campo of ['valor_numerico', 'percentual'] as const) {
      if (contribuicao[campo] !== null && typeof contribuicao[campo] !== 'number') throw new Error('Valor de contribuicao fora do schema');
    }
  }
  return dados as ExtracaoCct;
}

function validarRespostaExtracao(resposta: string, provedor: string): ExtracaoCct {
  let bruto: unknown;
  try {
    bruto = JSON.parse(resposta.replace(/^```json\s*|\s*```$/g, '').trim());
  } catch {
    throw new Error(`${provedor} nao retornou JSON valido para a CCT`);
  }
  return validarExtracaoCct(bruto);
}

async function extrairCctComAnthropic(textoBruto: string): Promise<ExtracaoCct> {
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY nao configurada');
  const resposta = await anthropic.messages.create({
    model: env.anthropicModel,
    max_tokens: 2_000,
    temperature: 0,
    system: SYSTEM_PROMPT_EXTRACAO_CCT,
    messages: [{ role: 'user', content: `Extraia os dados desta CCT:\n\n${textoBruto}` }]
  });
  return validarRespostaExtracao(extrairTexto(resposta), 'Claude');
}

async function extrairCctComGemini(textoBruto: string): Promise<ExtracaoCct> {
  if (!gemini) throw new Error('GEMINI_API_KEY nao configurada');
  const model = gemini.getGenerativeModel({
    model: env.geminiModel,
    systemInstruction: SYSTEM_PROMPT_EXTRACAO_CCT,
    generationConfig: { temperature: 0, responseMimeType: 'application/json' }
  });
  const resposta = await model.generateContent(`Extraia os dados desta CCT:\n\n${textoBruto}`);
  return validarRespostaExtracao(resposta.response.text(), 'Gemini');
}

export async function extrairCctComIa(textoBruto: string): Promise<ExtracaoCct> {
  if (!textoBruto.trim()) throw new Error('Texto bruto da CCT vazio');
  return env.aiProvider === 'gemini'
    ? extrairCctComGemini(textoBruto)
    : extrairCctComAnthropic(textoBruto);
}

export async function consultarBuscador(pergunta: string): Promise<string> {
  if (!anthropic) throw new Error('Consultar o buscador requer ANTHROPIC_API_KEY configurada');
  const messages: Anthropic.MessageParam[] = [{
    role: 'user',
    content: anonimizarPergunta(pergunta)
  }];

  for (let tentativa = 0; tentativa < 5; tentativa += 1) {
    const resposta = await anthropic.messages.create({
      model: env.anthropicModel,
      max_tokens: 3_000,
      system: 'Você é um buscador e extrator de Convenções Coletivas de Trabalho. Use as ferramentas para consultar fontes oficiais. Não invente dados. Diferencie claramente dados encontrados no documento, inferências e informação indisponível. Responda com um resumo executivo e informe a fonte e o CNPJ consultado. Você não audita folhas, não calcula encargos e não analisa dados de funcionários.',
      tools,
      messages
    });
    messages.push({ role: 'assistant', content: resposta.content });
    const chamadas = resposta.content.filter((item): item is Anthropic.ToolUseBlock => item.type === 'tool_use');
    if (chamadas.length === 0) {
      return resposta.content.filter((item): item is Anthropic.TextBlock => item.type === 'text').map(item => item.text).join('\n');
    }

    const resultados: Anthropic.ToolResultBlockParam[] = [];
    for (const chamada of chamadas) {
      try {
        const input = chamada.input as Record<string, unknown>;
        let resultado: unknown;
        if (chamada.name === 'consultar_sistema_mediador') {
          const ano = Number(input.ano_vigencia);
          const laboral = await buscarESalvarCCT(String(input.cnpj_sindicato_laboral), ano);
          const patronal = input.cnpj_sindicato_patronal
            ? await buscarESalvarCCT(String(input.cnpj_sindicato_patronal), ano)
            : null;
          resultado = {
            fonte: 'Sistema Mediador - MTE',
            anoVigencia: ano,
            cnpjSindicatoLaboral: input.cnpj_sindicato_laboral,
            cnpjSindicatoPatronal: input.cnpj_sindicato_patronal ?? null,
            textoLaboral: laboral,
            textoPatronal: patronal
          };
        } else if (chamada.name === 'consultar_indice_ibge') {
          resultado = await consultarIndice(String(input.indice) as 'IPCA' | 'INPC', String(input.periodoInicio), String(input.periodoFim));
        } else {
          throw new Error(`Ferramenta desconhecida: ${chamada.name}`);
        }
        resultados.push({ type: 'tool_result', tool_use_id: chamada.id, content: JSON.stringify(resultado) });
      } catch (error) {
        resultados.push({ type: 'tool_result', tool_use_id: chamada.id, is_error: true, content: String(error) });
      }
    }
    messages.push({ role: 'user', content: resultados });
  }

  throw new Error('Limite de chamadas de ferramentas excedido');
}
