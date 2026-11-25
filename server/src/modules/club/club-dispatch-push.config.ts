import { createECDH, ECDH } from 'node:crypto';
import { isIP } from 'node:net';

const defaultOrigins = [
  'https://fcm.googleapis.com',
  'https://updates.push.services.mozilla.com',
  'https://push.services.mozilla.com',
  'https://web.push.apple.com',
];

export function base64url(value: unknown, length: number) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === length && bytes.toString('base64url') === value ? bytes : null;
}

export function p256PublicKey(value: unknown) {
  const bytes = base64url(value, 65);
  if (!bytes || bytes[0] !== 4) return null;
  try {
    ECDH.convertKey(bytes, 'prime256v1');
    return bytes;
  } catch {
    return null;
  }
}

function isProviderOrigin(url: URL) {
  return url.protocol === 'https:' && !url.username && !url.password &&
    !isIP(url.hostname) && !url.hostname.startsWith('[') &&
    url.hostname.includes('.') && !url.hostname.endsWith('.');
}

export function readPushOrigins(value = process.env.WEB_PUSH_ALLOWED_ORIGINS ?? '') {
  const origins = new Set(defaultOrigins);
  for (const origin of value.split(',').map(item => item.trim()).filter(Boolean)) {
    try {
      const url = new URL(origin);
      if (isProviderOrigin(url) && url.origin === origin) origins.add(origin);
    } catch { /* Ignore malformed entries. */ }
  }
  return origins;
}

export function pushEndpoint(value: unknown, origins: ReadonlySet<string>) {
  if (typeof value !== 'string' || value.length > 4096 ||
      !/^https:\/\/[^/?#@]+(?:[/?]|$)/i.test(value) || /[\u0000-\u0020\u007f\\#]/.test(value)) {
    return null;
  }
  try {
    const url = new URL(value);
    if (isProviderOrigin(url) && origins.has(url.origin)) return url;
  } catch { /* Invalid endpoint URL. */ }
  return null;
}

export function readVapid() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? '';
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim() ?? '';
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim() ?? '';
  const publicBytes = p256PublicKey(publicKey);
  const privateBytes = base64url(privateKey, 32);
  if (!publicBytes || !privateBytes) return null;
  try {
    const contact = new URL(subject);
    const email = contact.protocol === 'mailto:' && /^[^\s@]+@[^\s@]+$/.test(contact.pathname);
    const website = contact.protocol === 'https:' && !contact.username &&
      !contact.password && contact.hostname !== 'localhost';
    if ((!email && !website) || /\s/.test(subject)) return null;
    const key = createECDH('prime256v1');
    key.setPrivateKey(privateBytes);
    if (!key.getPublicKey().equals(publicBytes)) return null;
    return { publicKey, privateKey, subject };
  } catch {
    return null;
  }
}
