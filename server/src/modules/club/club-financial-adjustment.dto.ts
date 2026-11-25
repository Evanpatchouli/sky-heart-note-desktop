import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsMongoId, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { USER_ID_PATTERN, type ClubAdjustmentDecision, type ClubAdjustmentKind } from '@webapp-template/common';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const lower = ({ value }: { value: unknown }) => typeof value === 'string' ? value.toLowerCase() : value;
const supplied = (_object: unknown, value: unknown) => value !== undefined;

class AdjustmentAmountDto {
  @Transform(lower)
  @IsUUID('4')
  requestId: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountCents: number;

  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  reason: string;
}

export class RequestClubAdjustmentDto extends AdjustmentAmountDto {
  @IsIn(['member_penalty', 'customer_compensation'])
  kind: ClubAdjustmentKind;

  @ValidateIf((input: RequestClubAdjustmentDto, value) => input.kind === 'member_penalty' || value !== undefined)
  @Matches(USER_ID_PATTERN)
  memberUserId?: string;
}

export class PublishClubPenaltyDto extends AdjustmentAmountDto {
  @Matches(USER_ID_PATTERN)
  memberUserId: string;

  @ValidateIf(supplied)
  @IsMongoId()
  orderId?: string;
}

class AdjustmentRevisionDto {
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER - 1)
  expectedRevision: number;
}

export class DecideClubAdjustmentDto extends AdjustmentRevisionDto {
  @IsIn(['approved', 'rejected'])
  decision: ClubAdjustmentDecision;

  @ValidateIf(supplied)
  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  reason?: string;
}

export class RecordCompensationRefundDto extends AdjustmentRevisionDto {
  @Transform(lower)
  @IsUUID('4')
  requestId: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountCents: number;

  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/)
  occurredAt: string;

  @ValidateIf(supplied)
  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  evidence?: string;
}
