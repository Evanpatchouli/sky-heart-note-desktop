import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PRICING_PERIODS } from '@sky-club/common';
import type { PricingPeriod } from '@sky-club/common';
import { giftBusinessDatePattern } from './club-gift-segment.dto';

export class UpdateCommissionRuleDto {
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER - 1)
  expectedVersion: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['gift_times'])
  basis?: 'gift_times';

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  clubFeeCents: number;
}

export class GiftPriceSegmentDto {
  @IsIn(PRICING_PERIODS)
  period: PricingPeriod;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  paidGiftTimes: number;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  dailyGiftTimes: number;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  unitPriceCents: number;
}

class InitialGiftPriceSegmentDto extends GiftPriceSegmentDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  promotionalGiftTimes?: number;
}

export class ContinuationActionDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID('4')
  requestId: string;
}

export class ContinuationWindowDto {
  @Matches(giftBusinessDatePattern)
  @IsISO8601({ strict: true })
  startDate: string;

  @Matches(giftBusinessDatePattern)
  @IsISO8601({ strict: true })
  endDate: string;
}

export class RequestContinuationDto extends ContinuationActionDto {
  @IsIn(PRICING_PERIODS)
  period: PricingPeriod;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  paidGiftTimes: number;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  dailyGiftTimes: number;

  @Matches(giftBusinessDatePattern)
  @IsISO8601({ strict: true })
  startDate: string;

  @Matches(giftBusinessDatePattern)
  @IsISO8601({ strict: true })
  endDate: string;
}

export class AddContinuationQuoteDto extends ContinuationActionDto {
  @IsObject()
  @ValidateNested()
  @Type(() => GiftPriceSegmentDto)
  segment: GiftPriceSegmentDto;

  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID('4')
  customerRequestId?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => ContinuationWindowDto)
  window?: ContinuationWindowDto;
}

export class RecordContinuationReceiptDto extends ContinuationActionDto {
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  receivedAmountCents: number;

  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/)
  receivedAt: string;
}

export class UpdateOrderPricingDto {
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  ruleVersion: number;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER - 1)
  expectedRevision: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['gift_times'])
  basis?: 'gift_times';

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  dispatchFeeCents: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InitialGiftPriceSegmentDto)
  giftSegments: InitialGiftPriceSegmentDto[];

  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  personalDiscountCents?: number;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID('4')
  platformCouponId?: string | null;
}

export class RecordOrderReceiptDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID('4')
  requestId: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  pricingRevision: number;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  receivedAmountCents: number;

  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/,
  )
  receivedAt: string;
}

export class ReviewDispatchCommissionDto {
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  pricingRevision: number;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER - 1)
  expectedReviewRevision: number;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  ruleVersion: number;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  dispatchFeeCents: number;
}
