import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { prisma } from './db';
import { attachRequestAudit, requirePortalApiKey } from './middleware/security';
import { enquadramentoRoutes } from './routes/enquadramentoRoutes';
import { radarRoutes } from './routes/radarRoutes';
import { alertRoutes } from './routes/alertRoutes';
import { moduloDpRoutes } from './routes/moduloDpRoutes';
import { importacaoRoutes } from './routes/importacaoRoutes';

export function createApp() {
  const app = express();

  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false
  }));

  app.use(cors({
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      const allowed = env.corsOrigins.includes('*') || env.corsOrigins.includes(origin);
      if (allowed) return callback(null, true);
      return callback(new Error(`Origem bloqueada pelo CORS: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
  }));

  app.use(rateLimit({
    windowMs: env.rateLimitWindowMs,
    max: env.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: 'Muitas requisições em pouco tempo. Tente novamente mais tarde.' }
  }));

  app.use(express.text({ type: ['text/csv', 'application/csv'] }));
  app.use(express.json({ limit: '2mb' }));
  app.use(attachRequestAudit);

  if (env.portalAuthEnabled && !env.portalApiKey) {
    throw new Error('PORTAL_AUTH_ENABLED=true exige PORTAL_API_KEY configurada.');
  }

  if (env.portalAuthEnabled) {
    app.use(requirePortalApiKey(env.portalApiKey));
  }

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api', enquadramentoRoutes);
  app.use('/api', alertRoutes);
  app.use('/api', importacaoRoutes);
  app.use('/api/radar', radarRoutes);
  app.use('/modulo-dp', moduloDpRoutes);
  app.use('/api/modulo-dp', moduloDpRoutes);
  return app;
}

const app = createApp();

if (require.main === module) {
  const server = app.listen(env.port, () => {
    console.info(`Servidor rodando na porta ${env.port}`);
  });

  async function shutdown(signal: string): Promise<void> {
    console.info(`Recebido ${signal}, encerrando`);
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

export { app };
