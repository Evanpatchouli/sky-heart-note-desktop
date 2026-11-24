import { checkOrigin, canAccess, parseApp } from './app-access';
import type { Request } from 'express';

const request = (headers: Record<string, string>) =>
  ({ get: (key: string) => headers[key] }) as Request;

describe('application access', () => {
  it('combines roles without allowing unrelated legacy roles to grant access', () => {
    expect(canAccess('admin', ['common', 'employee'])).toBe(false);
    expect(canAccess('employee', ['common', 'employee'])).toBe(true);
    expect(canAccess('client', ['admin'])).toBe(true);
    expect(canAccess('admin', ['SUPER_ADMIN'])).toBe(false);
    expect(canAccess('client', [])).toBe(false);
    expect(() => parseApp('site')).toThrow();
  });

  it('accepts a trusted same-origin referer and rejects mismatched or missing sharing origins', () => {
    const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5175';
    expect(() =>
      checkOrigin(request({ referer: origin + '/login' }), 'client', true),
    ).not.toThrow();
    expect(() =>
      checkOrigin(
        request({ origin, referer: 'http://localhost:5173/' }),
        'admin',
        true,
      ),
    ).toThrow();
    expect(() => checkOrigin(request({}), 'client', true)).toThrow();
    expect(() => checkOrigin(request({ origin: 'null' }), 'client')).toThrow();
  });
});
