import fs from 'node:fs';
import { google, sheets_v4 } from 'googleapis';
import { env } from '../config/env';

const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets'
];
const DASHBOARD_SHEET_TITLE = 'CCTs Extraídas';
const DASHBOARD_HEADERS = ['Data', 'Sindicato/CNPJ', 'Link Drive', 'Resumo'];
const REGISTRY_SHEET_TITLE = 'Cadastro de Sindicatos';
const REGISTRY_HEADERS = ['CNPJ', 'Nome do Sindicato', 'UF', 'Categoria', 'Status de Monitorização'];

type DashboardSheet = { sheetId: number; title: string };
type AdminSheetStructure = { extracted: DashboardSheet; registry: DashboardSheet };

function createAuth() {
  return new google.auth.JWT({
    email: env.googleClientEmail,
    key: env.googlePrivateKey.replace(/\\n/g, '\n'),
    scopes: WORKSPACE_SCOPES
  });
}

export async function uploadPdfToDrive(fileName: string, filePath: string, folderId: string): Promise<string> {
  const drive = google.drive({ version: 'v3', auth: createAuth() });
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
  const sheets = google.sheets({ version: 'v4', auth: createAuth() });
  const dashboard = await ensureCctDashboard(sheetId);
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `'${dashboard.title}'!A:D`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] }
  });
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
  const sheets = google.sheets({ version: 'v4', auth: createAuth() });
  const layout = [
    { title: DASHBOARD_SHEET_TITLE, headers: DASHBOARD_HEADERS },
    { title: REGISTRY_SHEET_TITLE, headers: REGISTRY_HEADERS }
  ];

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

    const resolved = layout.map(({ title, headers }) => {
      const id = ids.get(title);
      if (id === undefined) throw new Error(`Não foi possível localizar ou criar a aba ${title}.`);
      return { sheetId: id, title, headers, range: `'${title}'!A1:${columnLetter(headers.length)}1` };
    });

    const current = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: sheetId,
      ranges: resolved.map(({ range }) => range)
    });
    const pendingHeaders = resolved.filter((_, index) => dashboardNeedsHeaders(current.data.valueRanges?.[index]?.values ?? undefined));
    if (pendingHeaders.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: pendingHeaders.map(({ range, headers }) => ({ range, values: [headers] }))
        }
      });
    }

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: resolved.flatMap(({ sheetId: id }) => headerFormatRequests(id)) }
    });

    const [extracted, registry] = resolved;
    return {
      extracted: { sheetId: extracted.sheetId, title: extracted.title },
      registry: { sheetId: registry.sheetId, title: registry.title }
    };
  } catch (error) {
    console.error('[WORKSPACE] Falha ao preparar a estrutura da planilha:', error);
    throw error;
  }
}

export async function ensureCctDashboard(sheetId: string): Promise<DashboardSheet> {
  const sheets = google.sheets({ version: 'v4', auth: createAuth() });

  try {
    const { extracted } = await ensureAdminSheetStructure(sheetId);
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