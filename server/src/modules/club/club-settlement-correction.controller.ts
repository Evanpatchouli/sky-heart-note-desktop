import { Body, Controller, Get, Param, Patch, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import type { SessionUser } from '../../auth/app-access';
import { AppAccess, AuthUser } from '../../auth/auth.decorator';
import Resp from '../../common/models/Resp';
import { CreateReportCorrectionDto } from './club-delivery.dto';
import { DecideClubAdjustmentDto } from './club-financial-adjustment.dto';
import { RequestSettlementCashCorrectionDto } from './club-settlement-close.dto';
import { ClubSettlementCorrectionService } from './club-settlement-correction.service';

@AppAccess('employee')
@Controller('employee/club')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class ClubSettlementCorrectionController {
  constructor(private readonly corrections: ClubSettlementCorrectionService) {}

  @Post('orders/:orderId/daily-reports/:reportId/correction-requests')
  async requestReport(@AuthUser() user: SessionUser, @Param('orderId') orderId: string,
    @Param('reportId') reportId: string, @Body() input: CreateReportCorrectionDto) {
    return Resp.success(await this.corrections.requestReport(user.id, orderId, reportId, input));
  }

  @Get('orders/:orderId/daily-reports/:reportId/correction-requests')
  async listReport(@AuthUser() user: SessionUser, @Param('orderId') orderId: string, @Param('reportId') reportId: string) {
    return Resp.success(await this.corrections.listReport(user.id, orderId, reportId));
  }

  @Get('orders/:orderId/settlement/cash-correction-requests')
  async cash(@AuthUser() user: SessionUser, @Param('orderId') orderId: string) {
    return Resp.success(await this.corrections.cash(user.id, orderId));
  }

  @Post('orders/:orderId/settlement/cash-correction-requests')
  async requestCash(@AuthUser() user: SessionUser, @Param('orderId') orderId: string,
    @Body() input: RequestSettlementCashCorrectionDto) {
    return Resp.success(await this.corrections.requestCash(user.id, orderId, input));
  }

  @Get('settlement-corrections')
  async list(@AuthUser() user: SessionUser) {
    return Resp.success(await this.corrections.listApprovals(user.id));
  }

  @Patch('orders/:orderId/settlement/corrections/:requestId/decision')
  async decide(@AuthUser() user: SessionUser, @Param('orderId') orderId: string,
    @Param('requestId') requestId: string, @Body() input: DecideClubAdjustmentDto) {
    return Resp.success(await this.corrections.decide(user.id, orderId, requestId, input));
  }
}
