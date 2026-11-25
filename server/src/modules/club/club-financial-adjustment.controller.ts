import { Body, Controller, Get, Param, Patch, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import type { SessionUser } from '../../auth/app-access';
import { AppAccess, AuthUser } from '../../auth/auth.decorator';
import Resp from '../../common/models/Resp';
import { DecideClubAdjustmentDto, PublishClubPenaltyDto, RecordCompensationRefundDto, RequestClubAdjustmentDto } from './club-financial-adjustment.dto';
import { ClubFinancialAdjustmentService } from './club-financial-adjustment.service';

const validation = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

@AppAccess('admin')
@UsePipes(validation)
@Controller('admin/club')
export class AdminClubFinancialAdjustmentController {
  constructor(private readonly adjustments: ClubFinancialAdjustmentService) {}

  @Get('penalties')
  async penalties(@AuthUser() actor: SessionUser) {
    return Resp.success(await this.adjustments.listPenalties(actor));
  }

  @Post('penalties')
  async publish(@AuthUser() actor: SessionUser, @Body() input: PublishClubPenaltyDto) {
    return Resp.success(await this.adjustments.publishPenalty(actor, input));
  }

  @Get('balance')
  async clubBalance(@AuthUser() actor: SessionUser) {
    return Resp.success(await this.adjustments.financeBalance(actor));
  }

  @Get('balance/members/:userId')
  async memberBalance(@AuthUser() actor: SessionUser, @Param('userId') userId: string) {
    return Resp.success(await this.adjustments.financeBalance(actor, userId));
  }
}

@AppAccess('employee')
@UsePipes(validation)
@Controller('employee/club')
export class EmployeeClubFinancialAdjustmentController {
  constructor(private readonly adjustments: ClubFinancialAdjustmentService) {}

  @Get('financial-adjustments')
  async approvals(@AuthUser() actor: SessionUser) {
    return Resp.success(await this.adjustments.listApprovals(actor));
  }

  @Patch('financial-adjustments/:id/decision')
  async decide(@AuthUser() actor: SessionUser, @Param('id') id: string, @Body() input: DecideClubAdjustmentDto) {
    return Resp.success(await this.adjustments.decide(actor, id, input));
  }

  @Get('orders/:orderId/financial-adjustments')
  async order(@AuthUser() actor: SessionUser, @Param('orderId') orderId: string) {
    return Resp.success(await this.adjustments.listOrder(actor, orderId));
  }

  @Post('orders/:orderId/financial-adjustments')
  async request(@AuthUser() actor: SessionUser, @Param('orderId') orderId: string, @Body() input: RequestClubAdjustmentDto) {
    return Resp.success(await this.adjustments.requestAdjustment(actor, orderId, input));
  }

  @Post('orders/:orderId/financial-adjustments/:id/refunds')
  async refund(@AuthUser() actor: SessionUser, @Param('orderId') orderId: string, @Param('id') id: string, @Body() input: RecordCompensationRefundDto) {
    return Resp.success(await this.adjustments.refund(actor, orderId, id, input));
  }

  @Get('balance')
  async balance(@AuthUser() actor: SessionUser) {
    return Resp.success(await this.adjustments.personalBalance(actor));
  }
}
