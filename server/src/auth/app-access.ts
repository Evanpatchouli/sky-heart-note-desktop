import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';

export const apps = ['admin', 'employee', 'client'] as const;
export type WebApp = (typeof apps)[number];

export interface SessionUser {
  app: WebApp;
  id: string;
  username?: string;
  nickname?: string;
  openid?: string;
  phone?: string;
  email?: string;
  roles: string[];
  permissions: string[];
}

export function parseApp(value: unknown): WebApp {
  if (!apps.includes(value as WebApp))
    throw new BadRequestException('无效的应用');
  return value as WebApp;
}

const allowedRoles: Record<WebApp, string[]> = {
  admin: ['admin'],
  employee: ['admin', 'employee'],
  client: ['admin', 'employee', 'common'],
};

export function canAccess(app: WebApp, roles: readonly string[]) {
  return allowedRoles[app].some((role) => roles.includes(role));
}

export function appOrigins() {
  return {
    admin: process.env.ADMIN_ORIGIN || 'http://localhost:5173',
    employee: process.env.EMPLOYEE_ORIGIN || 'http://localhost:5174',
    client: process.env.CLIENT_ORIGIN || 'http://localhost:5175',
    site: process.env.SITE_ORIGIN || 'http://localhost:5176',
  };
}

// A shared cookie alone cannot attest which frontend initiated an exchange.
export function checkOrigin(req: Request, app: WebApp, required = false) {
  let origin = req.get('origin');
  if (!origin && req.get('referer')) {
    try {
      origin = new URL(req.get('referer')!).origin;
    } catch {
      origin = 'invalid';
    }
  }
  if ((required || origin !== undefined) && origin !== appOrigins()[app]) {
    throw new ForbiddenException('请求来源与应用不匹配');
  }
}
