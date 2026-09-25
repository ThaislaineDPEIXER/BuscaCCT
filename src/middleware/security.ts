import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function attachRequestAudit(req: Request, res: Response, next: NextFunction): void {
  const requestId = crypto.randomUUID();
  res.setHeader('x-request-id', requestId);
  const startedAt = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    console.info(`[${req.method}] ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms)`);
  });

  next();
}

export function requirePortalApiKey(apiKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const provided = req.get('x-api-key') ?? req.get('authorization')?.replace(/^Bearer\s+/i, '');

    if (!provided || provided !== apiKey) {
      res.status(401).json({ erro: 'Chave da API do portal ausente ou inválida.' });
      return;
    }

    next();
  };
}
