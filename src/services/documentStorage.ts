import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Storage } from '@google-cloud/storage';

const gcsStorage = new Storage();

export type StoredDocument = {
  storagePath: string;
  hashSha256: string;
  bytes: number;
};

export async function storePdf(
  buffer: Buffer,
  rootDirectory: string,
  objectName: string,
  gcsBucketName?: string,
  storageClient: Pick<Storage, 'bucket'> = gcsStorage
): Promise<StoredDocument> {
  if (buffer.length === 0) throw new Error('Documento PDF vazio.');
  const hashSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const safeObjectName = objectName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const relativePath = gcsBucketName
    ? path.posix.join('cct', safeObjectName)
    : path.join('cct', safeObjectName);

  if (gcsBucketName) {
    const file = storageClient.bucket(gcsBucketName).file(relativePath);
    await file.save(buffer, {
      resumable: false,
      metadata: { contentType: 'application/pdf', metadata: { sha256: hashSha256 } },
      preconditionOpts: { ifGenerationMatch: 0 }
    }).catch(error => {
      if ((error as { code?: number }).code !== 412) throw error;
    });

    return { storagePath: `gs://${gcsBucketName}/${relativePath}`, hashSha256, bytes: buffer.length };
  }

  const absolutePath = path.join(rootDirectory, relativePath);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer, { flag: 'wx' }).catch(async error => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  });

  return { storagePath: relativePath, hashSha256, bytes: buffer.length };
}
