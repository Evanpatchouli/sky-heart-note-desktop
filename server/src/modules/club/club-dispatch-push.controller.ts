import {
  Body, Controller, Delete, Get, Put, Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { checkOrigin, type SessionUser } from '../../auth/app-access';
import { AppAccess, AuthUser } from '../../auth/auth.decorator';
import Resp from '../../common/models/Resp';
import { HeaderAuthorization } from '../../decorators/header.decorator';
import { ClubDispatchPushService } from './club-dispatch-push.service';

@AppAccess('employee')
@Controller('employee/dispatch-push')
export class ClubDispatchPushController {
  constructor(private readonly push: ClubDispatchPushService) {}

  @Get()
  async status(@Req() req: Request, @AuthUser() user: SessionUser, @HeaderAuthorization() token: string) {
    checkOrigin(req, 'employee', true);
    return Resp.success(await this.push.status(token, user.id));
  }

  @Put()
  async enable(
    @Req() req: Request,
    @AuthUser() user: SessionUser,
    @HeaderAuthorization() token: string,
    @Body() body: unknown,
  ) {
    checkOrigin(req, 'employee', true);
    return Resp.success(await this.push.enable(token, user.id, body));
  }

  @Delete()
  async disable(
    @Req() req: Request,
    @AuthUser() user: SessionUser,
    @HeaderAuthorization() token: string,
    @Body() body: unknown,
  ) {
    checkOrigin(req, 'employee', true);
    return Resp.success(await this.push.disable(token, user.id, body));
  }
}
