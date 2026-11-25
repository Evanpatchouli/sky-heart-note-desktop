import { Transform } from 'class-transformer';
import { Equals, IsIn, IsInt, IsISO8601, IsMongoId, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import type { TerminationHeartRule } from '@webapp-template/common';

const trim = Transform(({ value }) => typeof value === 'string' ? value.trim() : value);

export class RequestTerminationDto {
  @IsUUID('4')
  requestId: string;

  @ValidateIf((_, value) => value !== undefined && value !== '')
  @trim
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  reason?: string;

  @Equals(true)
  confirmed: true;
}

export class RecordTerminationChangeDto {
  @IsUUID('4')
  requestId: string;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision: number;

  @trim
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  reason: string;

  @IsIn(['original_paid', 'pending_review'])
  heartRule: TerminationHeartRule;

  @ValidateIf((_, value) => value !== undefined)
  @trim
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  customerRequestReference?: string;

  @ValidateIf((_, value) => value !== undefined)
  @trim
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  priorPostingReference?: string;
}

export class ConfirmTerminationTermsDto {
  @IsUUID('4')
  requestId: string;

  @IsMongoId()
  terminationId: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision: number;

  @Equals(true)
  confirmed: true;
}

export class RecordTerminationRefundDto extends ConfirmTerminationTermsDto {
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountCents: number;

  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/)
  occurredAt: string;
}
