import { CLUB_ID } from './club.schema';
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
import { ClubGiftSettlementService } from './club-gift-settlement.service';
import { CloseGiftSettlementDto } from './club-settlement-close.dto';

@AppAccess('employee')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
@Controller('employee/club/orders/:orderId')
export class ClubDeliveryController {
  constructor(
    private readonly delivery: ClubGiftDeliveryService,
    private readonly settlements: ClubGiftSettlementService,
  ) {}

  @Get('settlement')
  async settlement(@AuthUser() user: SessionUser, @Param('orderId') orderId: string) {
    return Resp.success(await this.settlements.personal(CLUB_ID, user.id, orderId));
  }

  @Post('settlement/close')
  async close(@AuthUser() user: SessionUser, @Param('orderId') orderId: string, @Body() input: CloseGiftSettlementDto) {
    return Resp.success(await this.settlements.close(CLUB_ID, user.id, orderId, input));
  }

  @Get('daily-reports')
  async history(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Query('after') after?: string,
  ) {
    return Resp.success(
      await this.delivery.history(CLUB_ID, user.id, orderId, after),
    );
  }

  @Post('shares/:shareId/execution-accounts/:accountId/daily-reports')
  async report(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Param('shareId') shareId: string,
    @Param('accountId') accountId: string,
    @Body() input: CreateDailyReportDto,
  ) {
    return Resp.success(await this.delivery.submit(CLUB_ID, user.id, orderId, { ...input, shareId, accountId }));
  }

  @Post('daily-reports/:reportId/corrections')
  async correct(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Param('reportId') reportId: string,
    @Body() input: CreateReportCorrectionDto,
  ) {
    return Resp.success(await this.delivery.submit(CLUB_ID, user.id, orderId, { ...input, kind: 'correction', reportId }));
  }
}
