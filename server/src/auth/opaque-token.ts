import { createHash, randomBytes } from 'node:crypto';

export const opaqueTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export const createOpaqueToken = () => randomBytes(32).toString('base64url');

export const digestToken = (value: string) =>
  createHash('sha256').update(value).digest('hex');
