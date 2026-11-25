import { CLUB_ID } from './club.schema';
import { Body, Controller, Param, Patch, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import type { SessionUser } from '../../auth/app-access';
import { AppAccess, AuthUser } from '../../auth/auth.decorator';
import Resp from '../../common/models/Resp';
import { ClubContinuationService } from './club-continuation.service';
import { AddContinuationQuoteDto, ContinuationActionDto, ContinuationWindowDto, RecordContinuationReceiptDto, RequestContinuationDto } from './club-pricing.dto';

const validation = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

@AppAccess('employee')
@UsePipes(validation)
@Controller('employee/club/orders/:orderId/continuation-quotes')
export class EmployeeContinuationController {
  constructor(private readonly continuations: ClubContinuationService) {}

  @Post()
  async quote(
    @AuthUser() user: SessionUser, @Param('orderId') orderId: string,
    @Body() input: AddContinuationQuoteDto,
  ) {
    return Resp.success(await this.continuations.quote(CLUB_ID, user.id, orderId, input));
  }

  @Patch(':quoteId/window')
  async window(
    @AuthUser() user: SessionUser, @Param('orderId') orderId: string,
    @Param('quoteId') quoteId: string, @Body() input: ContinuationWindowDto,
  ) {
    return Resp.success(await this.continuations.window(CLUB_ID, user.id, orderId, quoteId, input));
  }

  @Post(':quoteId/receipt')
  async receipt(
    @AuthUser() user: SessionUser, @Param('orderId') orderId: string,
    @Param('quoteId') quoteId: string, @Body() input: RecordContinuationReceiptDto,
  ) {
    return Resp.success(await this.continuations.receive(CLUB_ID, user.id, orderId, quoteId, input));
  }
}

@AppAccess('client')
@UsePipes(validation)
@Controller('client/orders/:orderId')
export class ClientContinuationController {
  constructor(private readonly continuations: ClubContinuationService) {}

  @Post('continuation-requests')
  async request(
    @AuthUser() user: SessionUser, @Param('orderId') orderId: string,
    @Body() input: RequestContinuationDto,
  ) {
    return Resp.success(await this.continuations.request(CLUB_ID, user.id, orderId, input));
  }

  @Post('continuation-quotes/:quoteId/acceptance')
  async accept(
    @AuthUser() user: SessionUser, @Param('orderId') orderId: string,
    @Param('quoteId') quoteId: string, @Body() input: ContinuationActionDto,
  ) {
    return Resp.success(await this.continuations.accept(CLUB_ID, user.id, orderId, quoteId, input));
  }
}
