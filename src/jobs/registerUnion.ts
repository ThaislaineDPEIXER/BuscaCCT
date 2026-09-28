import 'dotenv/config';
import { parseArgs } from 'node:util';
import { prisma } from '../db';

export type RegistroSindicato = {
  cnpj: string;
  nome: string;
  uf: string;
  categoria?: string;
  cidade?: string;
};

export function normalizarCnpjSindicato(cnpj: string): string {
  const digitos = cnpj.replace(/[.\-/\s]/g, '');
  if (!/^\d{14}$/.test(digitos)) {
    throw new Error(`CNPJ inválido: "${cnpj}". Informe exatamente 14 dígitos.`);
  }
  return digitos;
}

export function validarRegistroSindicato(entrada: Partial<RegistroSindicato>): RegistroSindicato {
  const nome = entrada.nome?.trim();
  const uf = entrada.uf?.trim().toUpperCase();
  if (!entrada.cnpj) throw new Error('Parâmetro obrigatório ausente: --cnpj');
  if (!nome) throw new Error('Parâmetro obrigatório ausente: --nome');
  if (!uf || !/^[A-Z]{2}$/.test(uf)) throw new Error('Parâmetro obrigatório ausente ou inválido: --uf (ex.: SC)');

  return {
    cnpj: normalizarCnpjSindicato(entrada.cnpj),
    nome,
    uf,
    categoria: entrada.categoria?.trim() || undefined,
    cidade: entrada.cidade?.trim() || undefined
  };
}

export async function registrarSindicato(entrada: Partial<RegistroSindicato>) {
  const registro = validarRegistroSindicato(entrada);
  const dados = {
    razaoSocial: registro.nome,
    uf: registro.uf,
    ...(registro.categoria ? { segmento: registro.categoria } : {}),
    ...(registro.cidade ? { cidade: registro.cidade } : {}),
    ativo: true,
    statusMonitoramento: 'ATIVO'
  };

  return prisma.sindicato.upsert({
    where: { cnpj: registro.cnpj },
    update: dados,
    create: { cnpj: registro.cnpj, ...dados }
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      cnpj: { type: 'string' },
      nome: { type: 'string' },
      uf: { type: 'string' },
      categoria: { type: 'string' },
      cidade: { type: 'string' }
    },
    strict: true
  });

  const existente = values.cnpj
    ? await prisma.sindicato.findUnique({ where: { cnpj: normalizarCnpjSindicato(values.cnpj) }, select: { id: true } })
    : null;
  const sindicato = await registrarSindicato(values);
  console.info(`[SINDICATO] ${existente ? 'Atualizado' : 'Registrado'}: ${sindicato.cnpj} - ${sindicato.razaoSocial} (${sindicato.uf}) | id=${sindicato.id}`);
}

if (require.main === module) {
  main()
    .catch(error => {
      console.error('[SINDICATO] Falha no registro:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
