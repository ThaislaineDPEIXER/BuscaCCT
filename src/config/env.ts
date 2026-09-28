import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  return value;
}

function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} deve ser numerica`);
  return parsed;
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

const aiProvider = process.env.AI_PROVIDER ?? 'anthropic';
if (!['anthropic', 'gemini'].includes(aiProvider)) {
  throw new Error('AI_PROVIDER deve ser anthropic ou gemini');
}
const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? '';
const geminiApiKey = process.env.GEMINI_API_KEY ?? '';
if (aiProvider === 'anthropic' && !anthropicApiKey) {
  throw new Error('ANTHROPIC_API_KEY e obrigatoria quando AI_PROVIDER=anthropic');
}
if (aiProvider === 'gemini' && !geminiApiKey) {
  throw new Error('GEMINI_API_KEY e obrigatoria quando AI_PROVIDER=gemini');
}

const documentStorageDriver = process.env.DOCUMENT_STORAGE_DRIVER ?? 'local';
if (!['local', 'workspace'].includes(documentStorageDriver)) {
  throw new Error('DOCUMENT_STORAGE_DRIVER deve ser local ou workspace');
}
const googleClientEmail = process.env.GOOGLE_CLIENT_EMAIL ?? '';
const googlePrivateKey = process.env.GOOGLE_PRIVATE_KEY ?? '';
const googleDriveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID ?? '';
const googleSheetId = process.env.GOOGLE_SHEET_ID ?? '';
const googleDriveInboxFolderId = process.env.GOOGLE_DRIVE_INBOX_FOLDER_ID ?? '';
if (documentStorageDriver === 'workspace' && [googleClientEmail, googlePrivateKey, googleDriveFolderId, googleSheetId].some(value => !value)) {
  throw new Error('Credenciais e IDs do Google Workspace sao obrigatorios quando DOCUMENT_STORAGE_DRIVER=workspace');
}

export const env = {
  port: numberEnv('PORT', 3000),
  databaseUrl: required('DATABASE_URL'),
  aiProvider,
  anthropicApiKey,
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514',
  anthropicVisionModel: process.env.ANTHROPIC_VISION_MODEL ?? 'claude-3-5-sonnet-20241022',
  geminiApiKey,
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-1.5-flash',
  ibgeBaseUrl: process.env.IBGE_BASE_URL ?? 'https://servicodados.ibge.gov.br/api/v3/agregados',
  ibgeIpcaAgregado: process.env.IBGE_IPCA_AGREGADO ?? '7060',
  ibgeInpcAgregado: process.env.IBGE_INPC_AGREGADO ?? '7061',
  mteUrl: process.env.MTE_MEDIADOR_URL ?? 'https://mediador.trabalho.gov.br/sistemas/mediador/ConsultarInstColetivo',
  mteCnpjSelector: process.env.MTE_CNPJ_SELECTOR ?? 'input[name="txbCnpjCei"]',
  mteTypeSelector: process.env.MTE_TYPE_SELECTOR ?? 'select[name="cboTipoInst"]',
  mteTypeLabel: process.env.MTE_TYPE_LABEL ?? 'Convenção Coletiva',
  mteValiditySelector: process.env.MTE_VALIDITY_SELECTOR ?? 'select[name="cboVigencia"]',
  mteValidityLabel: process.env.MTE_VALIDITY_LABEL ?? 'Vigentes',
  mteSearchSelector: process.env.MTE_SEARCH_SELECTOR ?? '#btnPesquisar',
  mteResultSelector: process.env.MTE_RESULT_SELECTOR ?? 'table#tabelaResultados',
  mteResultLinkSelector: process.env.MTE_RESULT_LINK_SELECTOR ?? 'table#tabelaResultados tbody tr:first-child a',
  mteCaptchaSelector: process.env.MTE_CAPTCHA_SELECTOR ?? '#imgCaptcha',
  mteMaxAttempts: numberEnv('MTE_MAX_ATTEMPTS', 3),
  mteNavigationTimeoutMs: numberEnv('MTE_NAVIGATION_TIMEOUT_MS', 60_000),
  mteRequestDelayMs: numberEnv('MTE_REQUEST_DELAY_MS', 10_000),
  mteBatchSize: numberEnv('MTE_BATCH_SIZE', 50),
  mteStaleAfterHours: numberEnv('MTE_STALE_AFTER_HOURS', 72),
  mteDelayMinMs: numberEnv('MTE_DELAY_MIN_MS', 30_000),
  mteDelayMaxMs: numberEnv('MTE_DELAY_MAX_MS', 60_000),
  workerLockTtlMs: numberEnv('WORKER_LOCK_TTL_MS', 20 * 60_000),
  mteRetryBaseDelayMs: numberEnv('MTE_RETRY_BASE_DELAY_MS', 15 * 60_000),
  mteRetryMaxDelayMs: numberEnv('MTE_RETRY_MAX_DELAY_MS', 6 * 60 * 60_000),
  cronTimezone: process.env.CRON_TIMEZONE ?? 'America/Sao_Paulo',
  googleApiKey: process.env.GOOGLE_CUSTOM_SEARCH_API_KEY ?? '',
  googleSearchEngineId: process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID ?? '',
  radarMaxPages: numberEnv('RADAR_MAX_PAGES', 5),
  radarRequestDelayMs: numberEnv('RADAR_REQUEST_DELAY_MS', 2_000),
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: numberEnv('SMTP_PORT', 587),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPassword: process.env.SMTP_PASSWORD ?? '',
  alertEmailFrom: process.env.ALERT_EMAIL_FROM ?? '',
  alertEmailTo: process.env.ALERT_EMAIL_TO ?? '',
  portalAuthEnabled: booleanEnv('PORTAL_AUTH_ENABLED', process.env.NODE_ENV === 'production'),
  portalApiKey: process.env.PORTAL_API_KEY ?? '',
  corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(',').map(value => value.trim()).filter(Boolean),
  rateLimitWindowMs: numberEnv('RATE_LIMIT_WINDOW_MS', 60_000),
  rateLimitMax: numberEnv('RATE_LIMIT_MAX', 120),
  uploadRateLimitWindowMs: numberEnv('UPLOAD_RATE_LIMIT_WINDOW_MS', 60 * 60_000),
  uploadRateLimitMax: numberEnv('UPLOAD_RATE_LIMIT_MAX', 20),
  aiRateLimitWindowMs: numberEnv('AI_RATE_LIMIT_WINDOW_MS', 60_000),
  aiRateLimitMax: numberEnv('AI_RATE_LIMIT_MAX', 30),
  tiWebhookUrl: process.env.TI_WEBHOOK_URL ?? '',
  documentStoragePath: process.env.DOCUMENT_STORAGE_PATH ?? 'storage',
  documentStorageDriver,
  googleClientEmail,
  googlePrivateKey,
  googleDriveFolderId,
  googleSheetId,
  googleDriveInboxFolderId
};
