import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsMongoId, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import type { GiftPriceShift } from '@sky-club/common';

const timestamp = /T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const lower = ({ value }: { value: unknown }) => typeof value === 'string' ? value.toLowerCase() : value;

export class GiftPriceShiftDto implements GiftPriceShift {
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  quoteSegment: number;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  giftTimes: number;

  @IsIn(['normal', 'double'])
  targetPeriod: GiftPriceShift['targetPeriod'];

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  targetUnitPriceCents: number;
}

export class ProposeGiftPriceAdjustmentDto extends GiftPriceShiftDto {
  @Transform(lower)
  @IsUUID('4')
  requestId: string;

  @Matches(/^[a-f0-9]{64}$/)
  expectedVersion: string;

  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  reason: string;
}

export class GiftPriceAdjustmentActionDto {
  @IsMongoId()
  adjustmentId: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision: number;

  @Transform(lower)
  @IsUUID('4')
  requestId: string;
}

export class DecideGiftPriceAdjustmentDto extends GiftPriceAdjustmentActionDto {
  @IsIn(['accept', 'decline'])
  decision: 'accept' | 'decline';
}

export class RecordOfflineGiftPriceDecisionDto extends DecideGiftPriceAdjustmentDto {
  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  evidence: string;

  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(timestamp)
  occurredAt: string;
}

export class RecordGiftPricePaymentDto extends GiftPriceAdjustmentActionDto {
  @IsIn(['supplement', 'refund'])
  kind: 'supplement' | 'refund';

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountCents: number;

  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(timestamp)
  occurredAt: string;

  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  reason?: string;
}
