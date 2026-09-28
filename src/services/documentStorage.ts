import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type StoredDocument = {
  storagePath: string;
  hashSha256: string;
  bytes: number;
};

export async function storePdf(
  buffer: Buffer,
  rootDirectory: string,
  objectName: string
): Promise<StoredDocument> {
  if (buffer.length === 0) throw new Error('Documento PDF vazio.');
  const hashSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const safeObjectName = objectName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const relativePath = path.join('cct', safeObjectName);
  const absolutePath = path.join(rootDirectory, relativePath);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer, { flag: 'wx' }).catch(async error => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  });

  return { storagePath: relativePath, hashSha256, bytes: buffer.length };
}

export function resolveStoredDocumentPath(rootDirectory: string, storagePath: string): string | null {
  if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) return null;
  const absolutePath = path.resolve(rootDirectory, storagePath);
  const rootPath = path.resolve(rootDirectory);
  return absolutePath.startsWith(`${rootPath}${path.sep}`) ? absolutePath : null;
}
