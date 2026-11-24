import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await derive(password, salt, 32)) as Buffer;
  return ['scrypt', salt, hash.toString('hex')].join('$');
}

export async function matchesPassword(password: string, encoded: string) {
  if (!encoded) return false;
  if (!encoded.startsWith('scrypt$')) return password === encoded; // Legacy template accounts.
  const [, salt, hash] = encoded.split('$');
  if (!/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{64}$/.test(hash))
    return false;
  const actual = (await derive(password, salt, 32)) as Buffer;
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
