import fs from 'node:fs';
import { drive as createDriveClient } from '@googleapis/drive';
import { auth, sheets as createSheetsClient, sheets_v4 } from '@googleapis/sheets';
import { env } from '../config/env';
import {
  EMPRESA_HEADERS,
  SINDICATO_HEADERS,
  alinharAoCabecalho,
  completarCabecalho,
  sanitizarEmpresas,
  sanitizarSindicatos,
  type EmpresaPlanilha,
  type LinhaRejeitada,
  type SindicatoPlanilha
} from './adminSheetParser';

const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets'
];
export const SHEET_LAYOUT = {
  painel: {
    title: 'Painel de CCTs',
    headers: ['Data', 'Empresa Vinculada', 'Sindicato Laboral', 'Resumo/Impacto', 'Link PDF']
  },
  matriz: {
    title: 'Matriz de Enquadramento',
    headers: ['CNPJ Empresa', 'Razão Social', 'CNAE', 'Sindicato Mapeado', 'Tipo', 'Grau', 'Status', 'Validado por', 'Data da Validação', 'Observações']
  },
  cadastro: {
    title: 'Cadastro de Empresas',
    headers: EMPRESA_HEADERS
  },
  sindicatos: {
    title: 'Cadastro de Sindicatos',
    headers: SINDICATO_HEADERS
  }
} as const;

type SheetKey = keyof typeof SHEET_LAYOUT;
type DashboardSheet = { sheetId: number; title: string };
type AdminSheetStructure = Record<SheetKey, DashboardSheet>;
export type AdminSheetData = {
  empresas: EmpresaPlanilha[];
  sindicatos: SindicatoPlanilha[];
  rejeitadas: LinhaRejeitada[];
};

function createAuth() {
  return new auth.JWT({
    email: env.googleClientEmail,
    key: env.googlePrivateKey.replace(/\\n/g, '\n'),
    scopes: WORKSPACE_SCOPES
  });
}

function sheetsClient() {
  return createSheetsClient({ version: 'v4', auth: createAuth() });
}

export async function uploadPdfToDrive(fileName: string, filePath: string, folderId: string): Promise<string> {
  const drive = createDriveClient({ version: 'v3', auth: createAuth() });
  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
      mimeType: 'application/pdf'
    },
    media: {
      mimeType: 'application/pdf',
      body: fs.createReadStream(filePath)
    },
    fields: 'id,webViewLink'
  });
  const fileId = created.data.id;
  if (!fileId) throw new Error('Google Drive nao retornou o ID do PDF enviado.');

  await drive.permissions.create({
    fileId,
    requestBody: { type: 'anyone', role: 'reader' }
  });

  return created.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`;
}

export async function appendRowToSheet(sheetId: string, values: string[]): Promise<void> {
  const sheets = sheetsClient();
  const dashboard = await ensureCctDashboard(sheetId);
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `'${dashboard.title}'!A:${columnLetter(SHEET_LAYOUT.painel.headers.length)}`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] }
  });
}

export type DocumentoPendente = { id: string; nome: string; mimeType: string; tamanho: number };
export type StatusImportacao = 'importado' | 'erro';

const PROPRIEDADE_IMPORTACAO = 'radarImportacao';

function driveClient() {
  return createDriveClient({ version: 'v3', auth: createAuth() });
}

export async function listarDocumentosPendentes(folderId: string, reprocessarPlanilhasSindicais = false): Promise<DocumentoPendente[]> {
  if (!/^[A-Za-z0-9_-]+$/.test(folderId)) throw new Error('GOOGLE_DRIVE_INBOX_FOLDER_ID inválido.');
  const drive = driveClient();
  const documentos: DocumentoPendente[] = [];
  const subpastas = await drive.files.list({
    q: `'${folderId}' in parents and name = 'Cadastros de Sindicatos' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'nextPageToken, files(id)',
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  const pastas = [folderId, ...(subpastas.data.files ?? []).flatMap(pasta => pasta.id ? [pasta.id] : [])];

  for (const pastaId of pastas) {
    let pageToken: string | undefined;
    do {
      const reprocessarNestaPasta = reprocessarPlanilhasSindicais && pastaId !== folderId;
      const pagina = await drive.files.list({
        q: [
          `'${pastaId}' in parents`,
          'trashed = false',
          "mimeType != 'application/vnd.google-apps.folder'",
          `not appProperties has { key='${PROPRIEDADE_IMPORTACAO}' and value='importado' }`,
          ...(reprocessarNestaPasta ? [] : [`not appProperties has { key='${PROPRIEDADE_IMPORTACAO}' and value='erro' }`])
        ].join(' and '),
        fields: 'nextPageToken, files(id, name, mimeType, size, appProperties)',
        orderBy: 'createdTime',
        pageSize: 100,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });
      for (const arquivo of pagina.data.files ?? []) {
        if (arquivo.appProperties?.[PROPRIEDADE_IMPORTACAO] === 'erro' && ![
          'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ].includes(arquivo.mimeType ?? '')) continue;
        if (arquivo.id && arquivo.name) {
          documentos.push({ id: arquivo.id, nome: arquivo.name, mimeType: arquivo.mimeType ?? '', tamanho: Number(arquivo.size ?? 0) });
        }
      }
      pageToken = pagina.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  return documentos;
}

export async function baixarArquivoDrive(fileId: string): Promise<Buffer> {
  const resposta = await driveClient().files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(resposta.data as ArrayBuffer);
}

export async function marcarDocumento(fileId: string, status: StatusImportacao, detalhe: string): Promise<void> {
  await driveClient().files.update({
    fileId,
    supportsAllDrives: true,
    requestBody: {
      appProperties: {
        [PROPRIEDADE_IMPORTACAO]: status,
        radarImportadoEm: new Date().toISOString(),
        radarDetalhe: detalhe.slice(0, 90)
      }
    }
  });
}

export async function appendAdminRows(sheetId: string, aba: 'cadastro' | 'sindicatos', rows: string[][]): Promise<void> {
  if (rows.length === 0) return;
  const sheets = sheetsClient();
  const estrutura = await ensureAdminSheetStructure(sheetId);
  const { title } = estrutura[aba];
  const cabecalho = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `'${title}'!1:1` });
  const cabecalhoReal = (cabecalho.data.values?.[0] ?? []).map(valor => String(valor ?? ''));
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `'${title}'!A:${columnLetter(cabecalhoReal.length)}`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: alinharAoCabecalho(rows, SHEET_LAYOUT[aba].headers, cabecalhoReal) }
  });
}

export async function syncEnquadramentoMatrix(sheetId: string, rows: string[][]): Promise<void> {
  const sheets = sheetsClient();
  const { matriz } = await ensureAdminSheetStructure(sheetId);
  const lastColumn = columnLetter(SHEET_LAYOUT.matriz.headers.length);

  try {
    await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: `'${matriz.title}'!A2:${lastColumn}` });
    if (rows.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `'${matriz.title}'!A2`,
        valueInputOption: 'RAW',
        requestBody: { values: rows }
      });
    }
    console.info(`[WORKSPACE] Matriz de enquadramento sincronizada (${rows.length} vínculos).`);
  } catch (error) {
    console.error('[WORKSPACE] Falha ao sincronizar a matriz de enquadramento:', error);
    throw error;
  }
}

export async function readAdminSheetData(sheetId: string): Promise<AdminSheetData> {
  const sheets = sheetsClient();
  const { cadastro, sindicatos } = await ensureAdminSheetStructure(sheetId);

  try {
    const leitura = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: sheetId,
      ranges: [`'${cadastro.title}'!A:Z`, `'${sindicatos.title}'!A:Z`],
      valueRenderOption: 'FORMATTED_VALUE'
    });
    const [valoresEmpresas, valoresSindicatos] = (leitura.data.valueRanges ?? []).map(range => range.values ?? undefined);
    const empresas = sanitizarEmpresas(valoresEmpresas, cadastro.title);
    const sindicatosLidos = sanitizarSindicatos(valoresSindicatos, sindicatos.title);

    console.info(`[WORKSPACE] Cadastros lidos: ${empresas.registros.length} empresas, ${sindicatosLidos.registros.length} sindicatos.`);
    return {
      empresas: empresas.registros,
      sindicatos: sindicatosLidos.registros,
      rejeitadas: [...empresas.rejeitadas, ...sindicatosLidos.rejeitadas]
    };
  } catch (error) {
    console.error('[WORKSPACE] Falha ao ler as abas de cadastro:', error);
    throw error;
  }
}

export function hasConditionalRule(rule: sheets_v4.Schema$ConditionalFormatRule, expectedText: string): boolean {
  const appliesToSummary = rule.ranges?.some(range => range.startColumnIndex === 3 && range.endColumnIndex === 4);
  const condition = rule.booleanRule?.condition;
  return Boolean(appliesToSummary && condition?.values?.some(value => typeof value.userEnteredValue === 'string' && value.userEnteredValue.includes(expectedText)));
}

export function dashboardNeedsHeaders(values: string[][] | undefined): boolean {
  return !values?.[0]?.some(value => value.trim());
}

function columnLetter(count: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + count - 1);
}

function headerFormatRequests(sheetId: number): sheets_v4.Schema$Request[] {
  return [
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount'
      }
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.25, green: 0.25, blue: 0.25 },
            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    }
  ];
}

export async function ensureAdminSheetStructure(sheetId: string): Promise<AdminSheetStructure> {
  const sheets = sheetsClient();
  const layout = (Object.keys(SHEET_LAYOUT) as SheetKey[]).map(key => ({ key, ...SHEET_LAYOUT[key] }));

  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: 'sheets(properties(sheetId,title))'
    });
    const ids = new Map<string, number>();
    for (const sheet of spreadsheet.data.sheets ?? []) {
      const { title, sheetId: id } = sheet.properties ?? {};
      if (typeof title === 'string' && typeof id === 'number') ids.set(title, id);
    }

    const missing = layout.filter(({ title }) => !ids.has(title));
    if (missing.length > 0) {
      const created = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests: missing.map(({ title }) => ({ addSheet: { properties: { title } } })) }
      });
      for (const reply of created.data.replies ?? []) {
        const { title, sheetId: id } = reply.addSheet?.properties ?? {};
        if (typeof title === 'string' && typeof id === 'number') ids.set(title, id);
      }
      console.info(`[WORKSPACE] Abas criadas: ${missing.map(({ title }) => title).join(', ')}.`);
    }

    const resolved = layout.map(({ key, title, headers }) => {
      const id = ids.get(title);
      if (id === undefined) throw new Error(`Não foi possível localizar ou criar a aba ${title}.`);
      return { key, sheetId: id, title, headers: [...headers] as string[], range: `'${title}'!1:1` };
    });

    const current = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: sheetId,
      ranges: resolved.map(({ range }) => range)
    });
    const pendingHeaders = resolved.flatMap(({ key, title, headers }, index) => {
      const atual = (current.data.valueRanges?.[index]?.values?.[0] ?? []).map(valor => String(valor ?? ''));
      if (key === 'cadastro' || key === 'sindicatos') {
        const completo = completarCabecalho(atual, headers);
        if (!completo) return [];
        if (atual.some(valor => valor.trim())) {
          console.warn(`[WORKSPACE] Aba ${title}: colunas acrescentadas ao cabeçalho: ${completo.slice(atual.filter(valor => valor.trim()).length).join(', ')}.`);
        }
        return [{ range: `'${title}'!A1`, values: [completo] }];
      }
      return dashboardNeedsHeaders([atual]) ? [{ range: `'${title}'!A1`, values: [headers] }] : [];
    });
    if (pendingHeaders.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: pendingHeaders }
      });
    }

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: resolved.flatMap(({ sheetId: id }) => headerFormatRequests(id)) }
    });

    return Object.fromEntries(
      resolved.map(({ key, sheetId: id, title }) => [key, { sheetId: id, title }])
    ) as AdminSheetStructure;
  } catch (error) {
    console.error('[WORKSPACE] Falha ao preparar a estrutura da planilha:', error);
    throw error;
  }
}

export async function ensureCctDashboard(sheetId: string): Promise<DashboardSheet> {
  const sheets = sheetsClient();

  try {
    const { painel: extracted } = await ensureAdminSheetStructure(sheetId);
    const dashboardSheetId = extracted.sheetId;
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: 'sheets(properties(sheetId),conditionalFormats)'
    });
    const existingRules = spreadsheet.data.sheets
      ?.find(sheet => sheet.properties?.sheetId === dashboardSheetId)
      ?.conditionalFormats ?? [];
    const requests: sheets_v4.Schema$Request[] = [];

    if (!existingRules.some(rule => hasConditionalRule(rule, 'Aumento') || hasConditionalRule(rule, 'Alerta'))) {
      requests.push({
        addConditionalFormatRule: {
          index: 0,
          rule: {
            ranges: [{ sheetId: dashboardSheetId, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 }],
            booleanRule: {
              condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=OR(REGEXMATCH($D2,"Aumento"),REGEXMATCH($D2,"Alerta"))' }] },
              format: { backgroundColor: { red: 1, green: 0.8, blue: 0.8 } }
            }
          }
        }
      });
    }

    if (!existingRules.some(rule => hasConditionalRule(rule, 'Sem alteração'))) {
      requests.push({
        addConditionalFormatRule: {
          index: 0,
          rule: {
            ranges: [{ sheetId: dashboardSheetId, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 }],
            booleanRule: {
              condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'Sem alteração' }] },
              format: { backgroundColor: { red: 0.8, green: 0.94, blue: 0.8 } }
            }
          }
        }
      });
    }

    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests }
      });
    }
    console.info('[WORKSPACE] Formatação do painel Google Sheets aplicada.');
    return extracted;
  } catch (error) {
    console.error('[WORKSPACE] Falha ao configurar a formatação do Google Sheets:', error);
    throw error;
  }
}

export async function setupSheetFormatting(sheetId: string): Promise<void> {
  await ensureCctDashboard(sheetId);
}