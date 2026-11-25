import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { SessionUser } from '../../auth/app-access';
import { AppAccess, AuthUser } from '../../auth/auth.decorator';
import Resp from '../../common/models/Resp';
import {
  CreateDailyReportDto,
  CreateReportCorrectionDto,
} from './club-delivery.dto';
import { ClubGiftDeliveryService } from './club-gift-delivery.service';

@AppAccess('employee')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
@Controller('employee/clubs/:clubId/orders/:orderId')
export class ClubDeliveryController {
  constructor(private readonly delivery: ClubGiftDeliveryService) {}

  @Get('daily-reports')
  async history(
    @AuthUser() user: SessionUser,
    @Param('clubId') clubId: string,
    @Param('orderId') orderId: string,
    @Query('after') after?: string,
  ) {
    return Resp.success(
      await this.delivery.history(clubId, user.id, orderId, after),
    );
  }

  @Post('shares/:shareId/execution-accounts/:accountId/daily-reports')
  async report(
    @AuthUser() user: SessionUser,
    @Param('clubId') clubId: string,
    @Param('orderId') orderId: string,
    @Param('shareId') shareId: string,
    @Param('accountId') accountId: string,
    @Body() input: CreateDailyReportDto,
  ) {
    return Resp.success(await this.delivery.submit(clubId, user.id, orderId, { ...input, shareId, accountId }));
  }

  @Post('daily-reports/:reportId/corrections')
  async correct(
    @AuthUser() user: SessionUser,
    @Param('clubId') clubId: string,
    @Param('orderId') orderId: string,
    @Param('reportId') reportId: string,
    @Body() input: CreateReportCorrectionDto,
  ) {
    return Resp.success(await this.delivery.submit(clubId, user.id, orderId, { ...input, kind: 'correction', reportId }));
  }
}
