import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { USER_ID_PATTERN } from '@webapp-template/common';
import { ORDER_SOURCES, type OrderSource } from './club-order.schema';

class CreateOrderDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID('4')
  requestId: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 120)
  recipientGameAccount: string;

  @ValidateIf((order, value) => value !== undefined || order.requestedHearts === undefined)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  requestedGiftTimes?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  requestedHearts?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  estimatedReceivedHearts?: number;
}

export class CreateDirectOrderDto extends CreateOrderDto {
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 80)
  customerLabel?: string;

  @ValidateIf((_, value) => value !== undefined)
  @Matches(USER_ID_PATTERN)
  existingCustomerUserId?: string;

  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 100)
  newCustomerNickname?: string;
}

export class OrderCustomerQuery {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 100)
  q: string;
}

export class CreateClientOrderDto extends CreateOrderDto {
  @ValidateIf((_, value) => value !== undefined)
  @Matches(USER_ID_PATTERN)
  dispatcherUserId?: string;
}

export class ClubOrderQuery {
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(ORDER_SOURCES)
  source?: OrderSource;

  @ValidateIf((_, value) => value !== undefined)
  @IsMongoId()
  after?: string;

  @ValidateIf((_, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class EmployeeClubOrderQuery extends ClubOrderQuery {
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['dispatcher'])
  responsibility?: 'dispatcher';
}
