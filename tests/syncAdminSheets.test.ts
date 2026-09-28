import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { prisma } from '../src/db';
import { sincronizarCadastros } from '../src/jobs/syncAdminSheets';
import { EMPRESA_HEADERS, SINDICATO_HEADERS, alinharAoCabecalho, completarCabecalho, sanitizarEmpresas, sanitizarSindicatos } from '../src/services/adminSheetParser';

test('completarCabecalho preserva colunas antigas e só acrescenta as que faltam', () => {
  const antigo = ['CNPJ', 'Razão Social', 'Nome Fantasia', 'CNAE Principal', 'CNAEs Secundários', 'UF', 'Município', '', ''];
  const completo = completarCabecalho(antigo, ['Código da Empresa', 'CNPJ', 'Razão Social', 'CNAE Principal', 'UF', 'Município', 'CCT (Registro MTE)']);
  assert.deepEqual(completo, ['CNPJ', 'Razão Social', 'Nome Fantasia', 'CNAE Principal', 'CNAEs Secundários', 'UF', 'Município', 'Código da Empresa', 'CCT (Registro MTE)']);
  assert.equal(completarCabecalho(completo!, ['cnpj', 'MUNICIPIO']), null);
  assert.deepEqual(completarCabecalho([], ['CNPJ', 'UF']), ['CNPJ', 'UF']);
});

test('alinharAoCabecalho grava cada valor na coluna de mesmo nome', () => {
  const alinhado = alinharAoCabecalho([['123', 'ACME', 'SC']], ['CNPJ', 'Razão Social', 'UF'], ['UF', 'Nome Fantasia', 'razao social', 'CNPJ']);
  assert.deepEqual(alinhado, [['SC', '', 'ACME', '123']]);
});

function cnpjDeTeste(prefixo: string): string {
  return `${prefixo}${randomUUID().replace(/\D/g, '').padEnd(12, '0').slice(0, 12)}`;
}

function linhaEmpresa(valores: Partial<Record<typeof EMPRESA_HEADERS[number], string>>): string[] {
  return EMPRESA_HEADERS.map(header => valores[header] ?? '');
}

test('sanitizarEmpresas limpa máscaras, ignora linhas vazias e reporta inválidas', () => {
  const { registros, rejeitadas } = sanitizarEmpresas([
    [...EMPRESA_HEADERS],
    linhaEmpresa({
      'Código da Empresa': ' 1001 ', CNPJ: '12.345.678/0001-95', 'Razão Social': ' ACME LTDA ', 'CNAE Principal': '4711-3/02',
      'Descrição CNAE': 'Comércio varejista', UF: 'sc', Município: 'Penha', 'CCT (Registro MTE)': 'sc000123/2026',
      'CNPJ Sindicato Laboral': '11.222.333/0001-81'
    }),
    linhaEmpresa({}),
    linhaEmpresa({ CNPJ: '123', 'Razão Social': 'Inválida', 'CNAE Principal': '4711302', UF: 'SC', Município: 'Penha' }),
    linhaEmpresa({ CNPJ: '12345678000195', 'Razão Social': 'CCT inválida', 'CNAE Principal': '4711302', UF: 'SC', Município: 'Penha', 'CCT (Registro MTE)': '2026' })
  ]);

  assert.equal(registros.length, 1);
  assert.deepEqual(
    { cnpj: registros[0].cnpj, razao: registros[0].razaoSocial, cnae: registros[0].cnaePrincipal, uf: registros[0].uf },
    { cnpj: '12345678000195', razao: 'ACME LTDA', cnae: '4711302', uf: 'SC' }
  );
  assert.equal(registros[0].descricaoCnae, 'Comércio varejista');
  assert.equal(registros[0].cnpjSindicatoLaboral, '11222333000181');
  assert.equal(registros[0].codigoErp, '1001');
  assert.equal(registros[0].cctRegistro, 'SC000123/2026');
  assert.deepEqual(rejeitadas.map(item => item.linha), [4, 5]);
  assert.match(rejeitadas[0].motivo, /14 dígitos/);
  assert.match(rejeitadas[1].motivo, /registro MTE/);
});

test('sanitizarSindicatos aceita colunas reordenadas e rejeita cabeçalho incompleto', () => {
  const { registros } = sanitizarSindicatos([
    ['UF', 'Nome do Sindicato', 'CNPJ', 'Base Territorial', 'Status de Monitorização'],
    ['sc', 'Sindicato Real', '11.222.333/0001-81', 'Penha, Itajaí', 'inativo']
  ]);
  assert.equal(registros.length, 1);
  assert.equal(registros[0].cnpj, '11222333000181');
  assert.deepEqual(registros[0].baseTerritorial, ['Penha', 'Itajaí']);
  assert.equal(registros[0].ativo, false);

  const semCabecalho = sanitizarSindicatos([['CNPJ', 'UF'], ['11222333000181', 'SC']]);
  assert.equal(semCabecalho.registros.length, 0);
  assert.match(semCabecalho.rejeitadas[0].motivo, /Nome do Sindicato/);
  assert.equal(sanitizarSindicatos([[...SINDICATO_HEADERS]]).rejeitadas.length, 0);
});

test('sincronizarCadastros grava cadastros e confirma apenas vínculos com sindicato existente', async () => {
  const cnpjSindicato = cnpjDeTeste('66');
  const cnpjInexistente = cnpjDeTeste('65');
  const cnpjEmpresa = cnpjDeTeste('55');

  const resumo = await sincronizarCadastros({
    rejeitadas: [],
    sindicatos: [{ linha: 2, cnpj: cnpjSindicato, razaoSocial: 'Sindicato Planilha', uf: 'SC', baseTerritorial: ['Penha'], ativo: true }],
    empresas: [{
      linha: 2, codigoErp: '2002', cctRegistro: 'SC000123/2026', cnpj: cnpjEmpresa, razaoSocial: 'Empresa Planilha', cnaePrincipal: '4711302',
      uf: 'SC', cidade: 'Penha', cnpjSindicatoLaboral: cnpjSindicato, cnpjSindicatoPatronal: cnpjInexistente
    }]
  });

  assert.equal(resumo.sindicatos, 1);
  assert.equal(resumo.empresas, 1);
  assert.equal(resumo.vinculosConfirmados, 1);
  assert.match(resumo.rejeitadas[0].motivo, /não está cadastrado/);
  assert.equal(await prisma.sindicato.count({ where: { cnpj: cnpjInexistente } }), 0);
  const cliente = await prisma.cliente.findUnique({ where: { cnpj: cnpjEmpresa } });
  assert.equal(cliente?.codigoErp, '2002');
  assert.equal(cliente?.cctRegistro, 'SC000123/2026');

  const vinculo = await prisma.enquadramentoSindical.findFirst({
    where: { cliente: { cnpj: cnpjEmpresa }, sindicato: { cnpj: cnpjSindicato } }
  });
  assert.equal(vinculo?.status, 'VALIDADO_DP');
  assert.equal(vinculo?.tipo, 'LABORAL');
  assert.match(vinculo?.validadoPor ?? '', /Planilha/);
});

test('sincronizarCadastros não reverte um vínculo rejeitado pelo DP', async () => {
  const cnpjSindicato = cnpjDeTeste('64');
  const cnpjEmpresa = cnpjDeTeste('54');
  const sindicato = await prisma.sindicato.create({ data: { cnpj: cnpjSindicato, razaoSocial: 'Sindicato Rejeitado', uf: 'SC' } });
  const cliente = await prisma.cliente.create({
    data: { cnpj: cnpjEmpresa, razaoSocial: 'Empresa', cnaePrincipal: '4711302', descricaoCnae: '', uf: 'SC', cidade: 'Penha' }
  });
  await prisma.enquadramentoSindical.create({
    data: { clienteId: cliente.id, sindicatoId: sindicato.id, tipo: 'LABORAL', status: 'REJEITADO' }
  });

  const resumo = await sincronizarCadastros({
    rejeitadas: [],
    sindicatos: [],
    empresas: [{
      linha: 3, cnpj: cnpjEmpresa, razaoSocial: 'Empresa', cnaePrincipal: '4711302',
      uf: 'SC', cidade: 'Penha', cnpjSindicatoLaboral: cnpjSindicato
    }]
  });

  assert.equal(resumo.vinculosPreservados, 1);
  assert.equal(resumo.vinculosConfirmados, 0);
  const vinculo = await prisma.enquadramentoSindical.findFirst({ where: { clienteId: cliente.id } });
  assert.equal(vinculo?.status, 'REJEITADO');
});
