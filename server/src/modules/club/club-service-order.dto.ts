import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { BUSINESS_DATE_PATTERN, USER_ID_PATTERN, type ServiceBusinessType, type ServiceOrderScope } from '@sky-club/common';
import { ClubOrderQuery } from './club-order.dto';

export const maxServiceOrderDays = 3660;
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const lower = ({ value }: { value: unknown }) => typeof value === 'string' ? value.toLowerCase() : value;
const supplied = (_object: unknown, value: unknown) => value !== undefined;

export class ServiceOrderQuery extends ClubOrderQuery {
  @ValidateIf(supplied)
  @IsIn(['daily_run'])
  businessType?: ServiceBusinessType;

  @ValidateIf(supplied)
  @IsIn(['dispatch', 'board', 'mine'])
  scope?: ServiceOrderScope;
}

export class ServiceOrderRequestDto {
  @Transform(lower)
  @IsUUID('4')
  requestId: string;
}

export class CreateServiceOrderDto extends ServiceOrderRequestDto {
  @IsIn(['daily_run'])
  businessType: ServiceBusinessType;

  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(120)
  recipientGameAccount: string;

  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(500)
  serviceDescription: string;

  @Matches(BUSINESS_DATE_PATTERN)
  @IsISO8601({ strict: true })
  startDate: string;

  @IsInt()
  @Min(1)
  @Max(maxServiceOrderDays)
  units: number;
}

export class CreateClientServiceOrderDto extends CreateServiceOrderDto {
  @ValidateIf(supplied)
  @Matches(USER_ID_PATTERN)
  dispatcherUserId?: string;
}

export class CreateEmployeeServiceOrderDto extends CreateServiceOrderDto {
  @Matches(USER_ID_PATTERN)
  customerUserId: string;
}

export class AssignServiceOrderDto extends ServiceOrderRequestDto {
  @Matches(USER_ID_PATTERN)
  dispatcherUserId: string;
}

export class PublishServiceOrderDto extends ServiceOrderRequestDto {
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountCents: number;

  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/)
  occurredAt: string;
}

export class ServiceOrderUnitDto extends ServiceOrderRequestDto {
  @IsInt()
  @Min(1)
  @Max(maxServiceOrderDays)
  unit: number;
}

export class DeliverServiceOrderDto extends ServiceOrderUnitDto {
  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(500)
  evidence: string;
}

export class StopServiceOrderDto extends ServiceOrderRequestDto {
  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  reason: string;
}
