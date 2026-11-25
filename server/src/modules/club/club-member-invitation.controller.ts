import { CLUB_ID } from './club.schema';
import { BadRequestException, Body, Controller, Header, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import type { Request } from 'express';
import { checkOrigin, type SessionUser } from '../../auth/app-access';
import { AppAccess, AuthUser } from '../../auth/auth.decorator';
import Resp from '../../common/models/Resp';
import { ClubMemberInvitationService } from './club-member-invitation.service';

class RegisterClubInviteDto {
  @IsString()
  @Length(1, 128)
  token: string;

  @IsString()
  @Length(1, 100)
  username: string;

  @IsString()
  @Length(1, 256)
  password: string;
}

@AppAccess('employee')
@Controller('employee/club/member-invitations')
export class EmployeeClubInvitationController {
  constructor(private readonly invites: ClubMemberInvitationService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  async issue(@AuthUser() actor: SessionUser) {
    return Resp.success(await this.invites.issue(CLUB_ID, actor.id));
  }
}

@Controller('client/club-invitations')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class ClientClubInvitationController {
  constructor(private readonly invites: ClubMemberInvitationService) {}

  @Post('register')
  @Header('Cache-Control', 'no-store')
  async register(@Body() input: RegisterClubInviteDto, @Req() req: Request) {
    checkOrigin(req, 'client', true);
    if (!req.is('application/json')) throw new BadRequestException('需要 JSON 请求');
    return Resp.success(await this.invites.register(input.token, input.username, input.password));
  }
}
