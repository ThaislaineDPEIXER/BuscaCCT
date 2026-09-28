import fs from 'node:fs';
import { google } from 'googleapis';
import { env } from '../config/env';

const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets'
];

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
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'CCTs!A:D',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] }
  });
}

export async function setupSheetFormatting(sheetId: string): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: createAuth() });

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId: 0, gridProperties: { frozenRowCount: 1 } },
              fields: 'gridProperties.frozenRowCount'
            }
          },
          {
            repeatCell: {
              range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.25, green: 0.25, blue: 0.25 },
                  textFormat: {
                    bold: true,
                    foregroundColor: { red: 1, green: 1, blue: 1 }
                  }
                }
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat)'
            }
          },
          {
            addConditionalFormatRule: {
              index: 0,
              rule: {
                ranges: [{ sheetId: 0, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 }],
                booleanRule: {
                  condition: {
                    type: 'CUSTOM_FORMULA',
                    values: [{ userEnteredValue: '=OR(REGEXMATCH($D2,"Aumento"),REGEXMATCH($D2,"Alerta"))' }]
                  },
                  format: { backgroundColor: { red: 1, green: 0.8, blue: 0.8 } }
                }
              }
            }
          },
          {
            addConditionalFormatRule: {
              index: 1,
              rule: {
                ranges: [{ sheetId: 0, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 }],
                booleanRule: {
                  condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'Sem alteração' }] },
                  format: { backgroundColor: { red: 0.8, green: 0.94, blue: 0.8 } }
                }
              }
            }
          }
        ]
      }
    });
    console.info('[WORKSPACE] Formatação do painel Google Sheets aplicada.');
  } catch (error) {
    console.error('[WORKSPACE] Falha ao configurar a formatação do Google Sheets:', error);
    throw error;
  }
}