import { Prisma } from '@prisma/client';
import { prisma } from '../db';

export async function adquirirWorkerLock(chave: string, ownerId: string, ttlMs: number): Promise<(() => Promise<void>) | null> {
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + ttlMs);
  const renovado = await prisma.workerLock.updateMany({
    where: {
      chave,
      OR: [{ ownerId }, { expiresAt: { lt: agora } }]
    },
    data: { ownerId, expiresAt: expiraEm }
  });

  if (renovado.count === 0) {
    try {
      await prisma.workerLock.create({ data: { chave, ownerId, expiresAt: expiraEm } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
      throw error;
    }
  }

  return async () => {
    await prisma.workerLock.deleteMany({ where: { chave, ownerId } });
  };
}