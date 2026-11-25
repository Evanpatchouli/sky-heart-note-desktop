import { Body, Controller, Param, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import type { SessionUser } from '../../auth/app-access';
import { AppAccess, AuthUser } from '../../auth/auth.decorator';
import Resp from '../../common/models/Resp';
import {
  DecideGiftPriceAdjustmentDto, GiftPriceAdjustmentActionDto, GiftPriceShiftDto, ProposeGiftPriceAdjustmentDto,
  RecordGiftPricePaymentDto, RecordOfflineGiftPriceDecisionDto,
} from './club-gift-price-adjustment.dto';
import { ClubGiftPriceAdjustmentService } from './club-gift-price-adjustment.service';

const validation = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

@AppAccess('employee')
@UsePipes(validation)
@Controller('employee/clubs/:clubId/orders/:orderId')
export class EmployeeGiftPriceAdjustmentController {
  constructor(private readonly amendments: ClubGiftPriceAdjustmentService) {}

  @Post('fulfillment/price-preview')
  async preview(@AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Param('orderId') orderId: string, @Body() input: GiftPriceShiftDto) {
    return Resp.success(await this.amendments.preview(clubId, user.id, orderId, input));
  }

  @Post('price-adjustment')
  async propose(@AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Param('orderId') orderId: string, @Body() input: ProposeGiftPriceAdjustmentDto) {
    return Resp.success(await this.amendments.propose(clubId, user.id, orderId, input));
  }

  @Post('price-adjustment/decision')
  async offline(@AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Param('orderId') orderId: string, @Body() input: RecordOfflineGiftPriceDecisionDto) {
    const { occurredAt, evidence, ...decision } = input;
    return Resp.success(await this.amendments.decide(clubId, user.id, orderId, decision, { occurredAt, evidence }));
  }

  @Post('price-adjustment/payments')
  async payment(@AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Param('orderId') orderId: string, @Body() input: RecordGiftPricePaymentDto) {
    return Resp.success(await this.amendments.payment(clubId, user.id, orderId, input));
  }

  @Post('price-adjustment/resume')
  async resume(@AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Param('orderId') orderId: string, @Body() input: GiftPriceAdjustmentActionDto) {
    return Resp.success(await this.amendments.resume(clubId, user.id, orderId, input));
  }
}

@AppAccess('client')
@UsePipes(validation)
@Controller('client/clubs/:clubId/orders/:orderId')
export class ClientGiftPriceAdjustmentController {
  constructor(private readonly amendments: ClubGiftPriceAdjustmentService) {}

  @Post('price-adjustment/decision')
  async decide(@AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Param('orderId') orderId: string, @Body() input: DecideGiftPriceAdjustmentDto) {
    return Resp.success(await this.amendments.decide(clubId, user.id, orderId, input));
  }
}
