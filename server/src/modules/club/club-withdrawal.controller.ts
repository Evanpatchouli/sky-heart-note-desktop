import { Body, Controller, Get, Param, Patch, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import type { SessionUser } from '../../auth/app-access';
import { AppAccess, AuthUser } from '../../auth/auth.decorator';
import Resp from '../../common/models/Resp';
import { DecideClubWithdrawalDto, RecordClubWithdrawalPaymentDto, RequestClubWithdrawalDto } from './club-withdrawal.dto';
import { ClubWithdrawalService } from './club-withdrawal.service';

const validation = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

@AppAccess('employee')
@UsePipes(validation)
@Controller('employee/club/withdrawals')
export class EmployeeClubWithdrawalController {
  constructor(private readonly withdrawals: ClubWithdrawalService) {}

  @Get()
  async listOwn(@AuthUser() actor: SessionUser) {
    return Resp.success(await this.withdrawals.listOwn(actor));
  }

  @Post()
  async request(@AuthUser() actor: SessionUser, @Body() input: RequestClubWithdrawalDto) {
    return Resp.success(await this.withdrawals.request(actor, input));
  }

  @Get('review')
  async listForReview(@AuthUser() actor: SessionUser) {
    return Resp.success(await this.withdrawals.listForReview(actor));
  }

  @Patch(':id/decision')
  async decide(@AuthUser() actor: SessionUser, @Param('id') id: string, @Body() input: DecideClubWithdrawalDto) {
    return Resp.success(await this.withdrawals.decide(actor, id, input));
  }
}

@AppAccess('admin')
@UsePipes(validation)
@Controller('admin/club/withdrawals')
export class AdminClubWithdrawalController {
  constructor(private readonly withdrawals: ClubWithdrawalService) {}

  @Get()
  async listForPayment(@AuthUser() actor: SessionUser) {
    return Resp.success(await this.withdrawals.listForPayment(actor));
  }

  @Post(':id/payments')
  async pay(@AuthUser() actor: SessionUser, @Param('id') id: string, @Body() input: RecordClubWithdrawalPaymentDto) {
    return Resp.success(await this.withdrawals.pay(actor, id, input));
  }
}
