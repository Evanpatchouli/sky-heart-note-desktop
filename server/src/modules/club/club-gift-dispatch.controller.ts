import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { IsMongoId, ValidateIf } from 'class-validator';
import type { SessionUser } from '../../auth/app-access';
import { AppAccess, AuthUser } from '../../auth/auth.decorator';
import Resp from '../../common/models/Resp';
import { ClaimGiftDispatchDto, ConfigureGiftDispatchDto, ReassignGiftDispatchDto } from './club-gift-dispatch.dto';
import { ClubGiftDispatchService } from './club-gift-dispatch.service';

class GiftClaimQuery {
  @ValidateIf(input => input.after !== undefined)
  @IsMongoId()
  after?: string;
}

@AppAccess('employee')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
@Controller('employee/clubs/:clubId')
export class ClubGiftDispatchController {
  constructor(private readonly dispatch: ClubGiftDispatchService) {}

  @Get('gift-candidates')
  async candidates(@AuthUser() user: SessionUser, @Param('clubId') clubId: string) {
    return Resp.success(await this.dispatch.candidates(clubId, user.id));
  }

  @Get('orders/:orderId/gift-dispatch')
  async preparation(@AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Param('orderId') orderId: string) {
    return Resp.success(await this.dispatch.preparation(clubId, user.id, orderId));
  }

  @Post('orders/:orderId/gift-dispatch')
  async configure(@AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Param('orderId') orderId: string,
    @Body() input: ConfigureGiftDispatchDto) {
    return Resp.success(await this.dispatch.configure(clubId, user.id, orderId, input));
  }

  @Post('orders/:orderId/gift-dispatch/reassign')
  async reassign(@AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Param('orderId') orderId: string,
    @Body() input: ReassignGiftDispatchDto) {
    return Resp.success(await this.dispatch.reassign(clubId, user.id, orderId, input));
  }

  @Get('gift-claims')
  async list(@AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Query() query: GiftClaimQuery) {
    return Resp.success(await this.dispatch.list(clubId, user.id, query.after));
  }

  @Get('gift-claims/:orderId')
  async detail(@AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Param('orderId') orderId: string) {
    return Resp.success(await this.dispatch.detail(clubId, user.id, orderId));
  }

  @Get('gift-claims/:orderId/receipts/:requestId')
  async receipt(@AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Param('orderId') orderId: string,
    @Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string) {
    return Resp.success(await this.dispatch.receipt(clubId, user.id, orderId, requestId.toLowerCase()));
  }

  @Post('gift-claims/:orderId')
  async claim(@AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Param('orderId') orderId: string,
    @Body() input: ClaimGiftDispatchDto) {
    return Resp.success(await this.dispatch.claim(clubId, user.id, orderId, input));
  }
}
