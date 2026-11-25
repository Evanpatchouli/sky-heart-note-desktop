import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { isObjectIdOrHexString } from 'mongoose';
import { checkOrigin, type SessionUser } from '../../auth/app-access';
import { AppAccess, AuthUser } from '../../auth/auth.decorator';
import Resp from '../../common/models/Resp';
import { HeaderAuthorization } from '../../decorators/header.decorator';
import { AppNotificationService } from './app-notification.service';
import { ClubDispatchPushService } from './club-dispatch-push.service';

function noticeId(value: unknown): string {
  if (typeof value !== 'string' || !isObjectIdOrHexString(value)) {
    throw new BadRequestException('通知标识格式无效');
  }
  return value;
}

class AppNotificationController {
  constructor(
    protected readonly notices: AppNotificationService,
    protected readonly push: ClubDispatchPushService,
  ) {}

  @Get('notifications')
  async list(@Req() req: Request, @AuthUser() user: SessionUser, @Query('after') after?: string, @Query('limit') rawLimit?: string) {
    checkOrigin(req, user.app, true);
    const limit = rawLimit === undefined ? 25 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || Array.isArray(rawLimit)) {
      throw new BadRequestException('通知页大小须介于 1 至 100');
    }
    return Resp.success(await this.notices.list(user.app, user.id, after === undefined ? undefined : noticeId(after), limit));
  }

  @Get('notifications/:id')
  async detail(@Req() req: Request, @AuthUser() user: SessionUser, @Param('id') id: string) {
    checkOrigin(req, user.app, true);
    return Resp.success(await this.notices.detail(user.app, user.id, noticeId(id)));
  }

  @Patch('notifications/:id/read')
  async markRead(@Req() req: Request, @AuthUser() user: SessionUser, @Param('id') id: string) {
    checkOrigin(req, user.app, true);
    return Resp.success(await this.notices.markRead(user.app, user.id, noticeId(id)));
  }

  @Get('notification-push')
  async status(@Req() req: Request, @AuthUser() user: SessionUser, @HeaderAuthorization() token: string) {
    checkOrigin(req, user.app, true);
    return Resp.success(await this.push.status(token, user.id, user.app));
  }

  @Put('notification-push')
  async enable(@Req() req: Request, @AuthUser() user: SessionUser, @HeaderAuthorization() token: string, @Body() body: unknown) {
    checkOrigin(req, user.app, true);
    return Resp.success(await this.push.enable(token, user.id, body, user.app));
  }

  @Delete('notification-push')
  async disable(@Req() req: Request, @AuthUser() user: SessionUser, @HeaderAuthorization() token: string, @Body() body: unknown) {
    checkOrigin(req, user.app, true);
    return Resp.success(await this.push.disable(token, user.id, body, user.app));
  }
}

@AppAccess('admin')
@Controller('admin')
export class AdminAppNotificationController extends AppNotificationController {
  constructor(notices: AppNotificationService, push: ClubDispatchPushService) { super(notices, push); }
}

@AppAccess('employee')
@Controller('employee')
export class EmployeeAppNotificationController extends AppNotificationController {
  constructor(notices: AppNotificationService, push: ClubDispatchPushService) { super(notices, push); }
}

@AppAccess('client')
@Controller('client')
export class ClientAppNotificationController extends AppNotificationController {
  constructor(notices: AppNotificationService, push: ClubDispatchPushService) { super(notices, push); }
}
