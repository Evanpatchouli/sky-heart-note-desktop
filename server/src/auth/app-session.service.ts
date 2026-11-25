import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Request, Response, CookieOptions } from 'express';
import { AppSession } from './app-session.schema';
import { apps, canAccess, type SessionUser, type WebApp } from './app-access';
import { UserModel } from '../modules/user-module/user.model';
import { RoleService } from '../modules/role-module/role.service';
import { createOpaqueToken, digestToken as digest, opaqueTokenPattern } from './opaque-token';

const lifetime = 7 * 24 * 60 * 60 * 1000;

const cookieName = (app: WebApp) => 'sky_grant_' + app;
const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure:
    process.env.NODE_ENV === 'production' ||
    process.env.APP_ENV === 'production',
  sameSite: 'lax',
  path: '/api/user',
});

function cookieHash(req: Request, app: WebApp): string | undefined {
  const prefix = cookieName(app) + '=';
  const value = req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  return value && opaqueTokenPattern.test(value) ? digest(value) : undefined;
}

@Injectable()
export class AppSessionService {
  constructor(
    @InjectModel(AppSession.name) private readonly sessions: Model<AppSession>,
    private readonly users: UserModel,
    private readonly roles: RoleService,
  ) {}

  private async profile(
    userId: string,
    app: WebApp,
  ): Promise<SessionUser | null> {
    const user = await this.users.findById(userId);
    if (!user || user.status !== 1) return null;
    const records = (
      await this.roles.findByIds(user.role_ids.map(String), {
        withPermission: true,
      })
    ).filter((role) => role.status === 1);
    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      openid: user.openid,
      phone: user.phone,
      email: user.email,
      app,
      roles: records.map((role) => role.role_code),
      permissions: [
        ...new Set(
          records
            .flatMap((role) => role.permissions ?? [])
            .filter((permission) => permission.status === 1)
            .map((permission) => permission.perm_code),
        ),
      ],
    };
  }

  async authenticate(token: string): Promise<SessionUser> {
    const session = await this.sessions.findOne({
      accessHash: digest(token),
      expiresAt: { $gt: new Date() },
    });
    if (!session) throw new UnauthorizedException('登录已失效');
    const user = await this.profile(session.userId, session.app);
    if (!user || !canAccess(session.app, user.roles))
      throw new UnauthorizedException('账号已失去应用访问权限');
    return user;
  }

  private async sourceUser(req: Request, source: WebApp, target: WebApp) {
    const shareHash = cookieHash(req, source);
    if (!shareHash || source === target) return null;
    const session = await this.sessions.findOne({
      app: source,
      shareHash,
      expiresAt: { $gt: new Date() },
    });
    if (!session) return null;
    const user = await this.profile(session.userId, source);
    return user &&
      canAccess(source, user.roles) &&
      canAccess(target, user.roles)
      ? user
      : null;
  }

  async candidates(req: Request, app: WebApp) {
    const users = await Promise.all(
      apps.map((source) => this.sourceUser(req, source, app)),
    );
    return users
      .filter((user): user is SessionUser => !!user)
      .map(({ app: sourceApp, id, username, nickname }) => ({
        sourceApp,
        id,
        username,
        nickname,
      }));
  }

  async borrow(
    req: Request,
    source: WebApp,
    target: WebApp,
    selectedId: string,
  ) {
    const user = await this.sourceUser(req, source, target);
    if (!user || user.id !== selectedId)
      throw new UnauthorizedException('所选账号授权已失效');
    return user.id;
  }

  async issue(req: Request, res: Response, userId: string, app: WebApp) {
    const user = await this.profile(userId, app);
    if (!user || !canAccess(app, user.roles))
      throw new ForbiddenException('该账号无权登录此应用');
    const token = createOpaqueToken();
    const grant = createOpaqueToken();
    const record = {
      userId,
      app,
      accessHash: digest(token),
      shareHash: digest(grant),
      expiresAt: new Date(Date.now() + lifetime),
    };
    const previous = cookieHash(req, app);
    const old =
      previous && (await this.sessions.findOne({ shareHash: previous, app }));
    if (old) {
      const { modifiedCount } = await this.sessions.updateOne(
        { _id: old._id, shareHash: previous },
        record,
      );
      if (!modifiedCount) throw new ConflictException('登录状态已更新，请重试');
    } else {
      await this.sessions.create(record);
    }
    res.cookie(cookieName(app), grant, {
      ...cookieOptions(),
      maxAge: lifetime,
    });
    return { ...user, token };
  }

  async logout(req: Request, res: Response, token: string, app: WebApp) {
    const removed = await this.sessions.findOneAndDelete({
      accessHash: digest(token),
      app,
    });
    if (removed && cookieHash(req, app) === removed.shareHash) {
      res.clearCookie(cookieName(app), cookieOptions());
    }
  }
}
