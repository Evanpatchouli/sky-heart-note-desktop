import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsMongoId, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import type { PriceAdjustmentDecision } from '@sky-club/common';
import { DeliveryPeriodShiftDto } from './club-fulfillment.dto';

export class ProposePriceAdjustmentDto extends DeliveryPeriodShiftDto {
  @IsUUID('4')
  requestId: string;

  @Matches(/^[a-f0-9]{64}$/)
  expectedVersion: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  reason: string;
}

export class RequestPriceReviewDto {
  @IsUUID('4')
  requestId: string;

  @Matches(/^[a-f0-9]{64}$/)
  expectedVersion: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  reason: string;

  @ValidateIf((_, value) => value !== undefined)
  @ValidateNested()
  @Type(() => DeliveryPeriodShiftDto)
  shift?: DeliveryPeriodShiftDto;
}

class AdjustPriceDto {
  @IsUUID('4')
  requestId: string;

  @IsMongoId()
  adjustmentId: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision: number;
}

export class DecidePriceAdjustmentDto extends AdjustPriceDto {
  @IsIn(['accept', 'decline'])
  decision: PriceAdjustmentDecision;
}

export class RecordPriceAdjustmentPaymentDto extends AdjustPriceDto {
  @IsIn(['supplement', 'refund'])
  kind: 'supplement' | 'refund';

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountCents: number;

  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/)
  occurredAt: string;
}
