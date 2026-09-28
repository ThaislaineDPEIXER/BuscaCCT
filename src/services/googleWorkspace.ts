import fs from 'node:fs';
import { google, sheets_v4 } from 'googleapis';
import { env } from '../config/env';

const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets'
];
const DASHBOARD_SHEET_TITLE = 'CCTs';
const DASHBOARD_HEADERS = ['Data', 'Sindicato', 'Link do Drive', 'Resumo da IA'];

type DashboardSheet = { sheetId: number; title: string };

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

export async function ensureCctDashboard(sheetId: string): Promise<DashboardSheet> {
  const sheets = google.sheets({ version: 'v4', auth: createAuth() });

  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: 'sheets(properties(sheetId,title),conditionalFormats)'
    });
    let dashboard = spreadsheet.data.sheets?.find(sheet => sheet.properties?.title === DASHBOARD_SHEET_TITLE);

    if (!dashboard?.properties?.sheetId) {
      const created = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: DASHBOARD_SHEET_TITLE } } }] }
      });
      dashboard = created.data.replies?.[0]?.addSheet;
    }

    if (!dashboard) {
      throw new Error('Não foi possível localizar ou criar a aba CCTs.');
    }
    const dashboardSheetId = dashboard.properties?.sheetId;
    const dashboardTitle = dashboard.properties?.title;
    if (typeof dashboardSheetId !== 'number' || typeof dashboardTitle !== 'string' || !dashboardTitle) {
      throw new Error('A aba CCTs não possui identificação válida.');
    }

    const headerRange = `'${dashboardTitle}'!A1:D1`;
    const headers = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: headerRange });
    if (dashboardNeedsHeaders(headers.data.values ?? undefined)) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: headerRange,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [DASHBOARD_HEADERS] }
      });
    }

    const existingRules = dashboard.conditionalFormats ?? [];
    const requests: sheets_v4.Schema$Request[] = [
      {
        updateSheetProperties: {
          properties: { sheetId: dashboardSheetId, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount'
        }
      },
      {
        repeatCell: {
          range: { sheetId: dashboardSheetId, startRowIndex: 0, endRowIndex: 1 },
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

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests }
    });
    console.info('[WORKSPACE] Formatação do painel Google Sheets aplicada.');
    return { sheetId: dashboardSheetId, title: dashboardTitle };
  } catch (error) {
    console.error('[WORKSPACE] Falha ao configurar a formatação do Google Sheets:', error);
    throw error;
  }
}

export async function setupSheetFormatting(sheetId: string): Promise<void> {
  await ensureCctDashboard(sheetId);
}