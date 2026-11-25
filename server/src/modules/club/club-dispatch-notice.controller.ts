import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsMongoId, Max, Min, ValidateIf } from 'class-validator';
import type { SessionUser } from '../../auth/app-access';
import { AppAccess, AuthUser } from '../../auth/auth.decorator';
import Resp from '../../common/models/Resp';
import { ClubDispatchNoticeService } from './club-dispatch-notice.service';

class DispatchNoticeQuery {
  @ValidateIf((_, value) => value !== undefined)
  @IsMongoId()
  after?: string;

  @ValidateIf((_, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

@AppAccess('employee')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
@Controller('employee/dispatch-notices')
export class ClubDispatchNoticeController {
  constructor(private readonly notices: ClubDispatchNoticeService) {}

  @Get()
  async list(
    @AuthUser() user: SessionUser,
    @Query() query: DispatchNoticeQuery,
  ) {
    return Resp.success(await this.notices.list(user.id, query));
  }

  @Get('unread')
  async unread(@AuthUser() user: SessionUser) {
    return Resp.success(await this.notices.unread(user.id));
  }

  @Get(':noticeId/claim-board')
  async locate(
    @AuthUser() user: SessionUser,
    @Param('noticeId') noticeId: string,
  ) {
    return Resp.success(await this.notices.locate(user.id, noticeId));
  }

  @Patch(':noticeId/read')
  async markRead(
    @AuthUser() user: SessionUser,
    @Param('noticeId') noticeId: string,
  ) {
    return Resp.success(await this.notices.markRead(user.id, noticeId));
  }
}
