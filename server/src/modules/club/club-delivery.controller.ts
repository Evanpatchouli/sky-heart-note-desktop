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
import { ClubDeliveryService } from './club-delivery.service';
import { ClubGiftDeliveryService } from './club-gift-delivery.service';

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
    private readonly legacyDelivery: ClubDeliveryService,
  ) {}

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
    const service = await this.deliveryFor(user.id, orderId);
    return Resp.success(await service.submit(CLUB_ID, user.id, orderId, { ...input, shareId, accountId }));
  }

  @Post('daily-reports/:reportId/corrections')
  async correct(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Param('reportId') reportId: string,
    @Body() input: CreateReportCorrectionDto,
  ) {
    const service = await this.deliveryFor(user.id, orderId);
    return Resp.success(await service.submit(CLUB_ID, user.id, orderId, { ...input, kind: 'correction', reportId }));
  }

  private async deliveryFor(userId: string, orderId: string) {
    const order = await this.delivery.orderForMember(CLUB_ID, userId, orderId);
    return order.dispatchPricing?.priceUnit === 'gift_times' ? this.delivery : this.legacyDelivery;
  }
}
