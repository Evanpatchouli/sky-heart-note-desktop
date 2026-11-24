import { randomInt } from 'node:crypto';
import { mongo } from 'mongoose';

export function isDuplicateKey(error: unknown, field: string) {
  return (
    error instanceof mongo.MongoServerError &&
    error.code === 11000 &&
    error.keyPattern?.[field] === 1
  );
}

export async function withNewUserId<T>(insert: (id: string) => Promise<T>) {
  for (let attempt = 0; attempt < 32; attempt++) {
    const id = randomInt(36 ** 4).toString(36).toUpperCase().padStart(4, '0');
    try {
      return await insert(id);
    } catch (error) {
      if (!isDuplicateKey(error, '_id')) throw error;
    }
  }
  throw new Error('暂时无法分配用户 ID');
}
