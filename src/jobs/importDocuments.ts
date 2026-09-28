import { env } from '../config/env';
import { prisma } from '../db';
import { mimeSuportado } from '../services/aiDocumentReader';
import { extrairCadastrosDeDocumento, lerCadastroSindicalExcel, montarLinhasImportacao } from '../services/documentImport';
import {
  appendAdminRows,
  baixarArquivoDrive,
  listarDocumentosPendentes,
  marcarDocumento,
  readAdminSheetData
} from '../services/googleWorkspace';

const TAMANHO_MAXIMO_BYTES = 20 * 1024 * 1024;

export type ResumoImportacaoDocumentos = {
  documentos: number;
  importados: number;
  comErro: number;
  empresas: number;
  sindicatos: number;
};

function mensagem(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function importarDocumentosDoDrive(): Promise<ResumoImportacaoDocumentos | null> {
  if (env.documentStorageDriver !== 'workspace' || !env.googleDriveInboxFolderId) {
    console.info('[DOCS] Pasta de entrada não configurada (GOOGLE_DRIVE_INBOX_FOLDER_ID); importação de documentos ignorada.');
    return null;
  }

  const pendentes = await listarDocumentosPendentes(env.googleDriveInboxFolderId, process.env.RETRY_FAILED_UNION_IMPORTS === 'true');
  const resumo: ResumoImportacaoDocumentos = { documentos: pendentes.length, importados: 0, comErro: 0, empresas: 0, sindicatos: 0 };
  if (pendentes.length === 0) {
    console.info('[DOCS] Nenhum documento novo na pasta de entrada.');
    return resumo;
  }

  const planilha = await readAdminSheetData(env.googleSheetId);
  const existentes = {
    empresas: new Set(planilha.empresas.map(empresa => empresa.cnpj)),
    sindicatos: new Set(planilha.sindicatos.map(sindicato => sindicato.cnpj))
  };

  for (const documento of pendentes) {
    try {
      const excel = ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(documento.mimeType);
      if (documento.tamanho > TAMANHO_MAXIMO_BYTES) {
        throw new Error(`Arquivo acima de ${TAMANHO_MAXIMO_BYTES / 1024 / 1024} MB.`);
      }

      if (!excel && !mimeSuportado(documento.mimeType)) {
        throw new Error(`Tipo de arquivo não suportado (${documento.mimeType || 'desconhecido'}). Use XLS, XLSX, PDF, PNG, JPEG ou WEBP.`);
      }
      const arquivo = await baixarArquivoDrive(documento.id);
      const linhas = excel ? lerCadastroSindicalExcel(arquivo, existentes, documento.nome)
        : mimeSuportado(documento.mimeType)
          ? montarLinhasImportacao(await extrairCadastrosDeDocumento(arquivo, documento.mimeType), existentes, documento.nome)
          : undefined;
      if (!linhas) throw new Error(`Tipo de arquivo não suportado (${documento.mimeType}).`);
      await appendAdminRows(env.googleSheetId, 'sindicatos', linhas.sindicatos);
      await appendAdminRows(env.googleSheetId, 'cadastro', linhas.empresas);
      for (const linha of linhas.sindicatos) existentes.sindicatos.add(linha[0]);
      for (const linha of linhas.empresas) existentes.empresas.add(linha[1]);

      const detalhe = `${linhas.empresas.length} empresas, ${linhas.sindicatos.length} sindicatos, ${linhas.duplicadas} duplicados, ${linhas.rejeitadas.length} rejeitados`;
      await marcarDocumento(documento.id, 'importado', detalhe);
      resumo.importados += 1;
      resumo.empresas += linhas.empresas.length;
      resumo.sindicatos += linhas.sindicatos.length;
      console.info(`[DOCS] "${documento.nome}": ${detalhe}.`);
      for (const rejeicao of linhas.rejeitadas) console.warn(`[DOCS] ${rejeicao}`);
    } catch (error) {
      resumo.comErro += 1;
      console.error(`[DOCS] Falha ao importar "${documento.nome}":`, mensagem(error));
      await marcarDocumento(documento.id, 'erro', mensagem(error)).catch(markError => {
        console.error(`[DOCS] Não foi possível marcar "${documento.nome}" com erro:`, mensagem(markError));
      });
    }
  }

  console.info(`[DOCS] Importação concluída: ${resumo.importados}/${resumo.documentos} documentos, ${resumo.empresas} empresas e ${resumo.sindicatos} sindicatos adicionados à planilha.`);
  return resumo;
}

if (require.main === module) {
  importarDocumentosDoDrive()
    .catch(error => {
      console.error('[DOCS] Falha na importação de documentos:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
