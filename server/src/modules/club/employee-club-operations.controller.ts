import { Body, Controller, Get, Param, Patch, Put, UsePipes, ValidationPipe } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsString, Length } from 'class-validator';
import type { SessionUser } from '../../auth/app-access';
import { AppAccess, AuthUser } from '../../auth/auth.decorator';
import Resp from '../../common/models/Resp';
import { ClubDirectoryService } from './club-directory.service';
import { CLUB_PERMISSIONS, type ClubPermission } from './club-permissions';
import { UpdateCommissionRuleDto } from './club-pricing.dto';
import { CLUB_ID } from './club.schema';

class UpdateClubNameDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 80)
  name: string;
}

class MembershipDto {
  @IsBoolean()
  active: boolean;
}

class DispatcherDto {
  @IsBoolean()
  dispatcher: boolean;
}

class PermissionDto {
  @IsIn(CLUB_PERMISSIONS)
  permission: ClubPermission;

  @IsBoolean()
  granted: boolean;
}

class DeputyDto {
  @IsBoolean()
  deputy: boolean;
}

@AppAccess('employee')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
@Controller('employee/club')
export class EmployeeClubOperationsController {
  constructor(private readonly directory: ClubDirectoryService) {}

  @Patch('name')
  async rename(@AuthUser() actor: SessionUser, @Body() input: UpdateClubNameDto) {
    return Resp.success(await this.directory.updateClubName(actor, input.name));
  }

  @Get('members')
  async members(@AuthUser() actor: SessionUser) {
    return Resp.success(await this.directory.listMembers(CLUB_ID, actor));
  }

  @Put('members/:userId')
  async setMembership(
    @AuthUser() actor: SessionUser, @Param('userId') userId: string, @Body() input: MembershipDto,
  ) {
    await this.directory.setMembership(actor, userId, input.active);
    return Resp.success(null);
  }

  @Patch('members/:userId/dispatcher')
  async setDispatcher(
    @AuthUser() actor: SessionUser, @Param('userId') userId: string, @Body() input: DispatcherDto,
  ) {
    return Resp.success(await this.directory.setMemberDispatcher(CLUB_ID, actor, userId, input.dispatcher));
  }

  @Get('commission-rule')
  async commissionRule(@AuthUser() actor: SessionUser) {
    return Resp.success(await this.directory.getCommissionRule(CLUB_ID, actor));
  }

  @Patch('commission-rule')
  async saveCommissionRule(@AuthUser() actor: SessionUser, @Body() input: UpdateCommissionRuleDto) {
    return Resp.success(await this.directory.updateCommissionRule(CLUB_ID, actor, input));
  }

  @Get('authorizations')
  async authorizations(@AuthUser() actor: SessionUser) {
    return Resp.success(await this.directory.listAuthorizations(actor));
  }

  @Patch('authorizations/:userId/permission')
  async setPermission(
    @AuthUser() actor: SessionUser, @Param('userId') userId: string, @Body() input: PermissionDto,
  ) {
    await this.directory.setMemberPermission(actor, userId, input.permission, input.granted);
    return Resp.success(null);
  }

  @Patch('authorizations/:userId/deputy')
  async setDeputy(
    @AuthUser() actor: SessionUser, @Param('userId') userId: string, @Body() input: DeputyDto,
  ) {
    await this.directory.setMemberDeputy(actor, userId, input.deputy);
    return Resp.success(null);
  }
}
