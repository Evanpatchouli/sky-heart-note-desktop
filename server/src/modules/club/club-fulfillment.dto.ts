import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsISO8601,
  IsIn,
  IsInt,
  IsMongoId,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  BUSINESS_DATE_PATTERN,
  PRICING_PERIODS,
  type DeliveryPeriodShift,
  type PricingPeriod,
} from '@webapp-template/common';
import { ClubOrderQuery } from './club-order.dto';

export class AgreementDeadlineDto {
  @Matches(BUSINESS_DATE_PATTERN)
  @IsISO8601({ strict: true })
  businessDate: string;
}

export class AgreedReportDatesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @Matches(BUSINESS_DATE_PATTERN, { each: true })
  @IsISO8601({ strict: true }, { each: true })
  businessDates: string[];
}

export class PersonalScheduleDto {
  @ValidateIf((_, value) => value !== null)
  @Matches(BUSINESS_DATE_PATTERN)
  @IsISO8601({ strict: true })
  startDate: string | null;

  @ValidateIf((_, value) => value !== null)
  @Matches(BUSINESS_DATE_PATTERN)
  @IsISO8601({ strict: true })
  endDate: string | null;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER - 1)
  expectedRevision: number;
}

export class FulfillmentQuery {
  @ValidateIf((_, value) => value !== undefined)
  @Matches(BUSINESS_DATE_PATTERN)
  @IsISO8601({ strict: true })
  through?: string;
}

export class FulfillmentExceptionsQuery extends ClubOrderQuery {
  @Matches(BUSINESS_DATE_PATTERN)
  @IsISO8601({ strict: true })
  through: string;
}

export class FulfillmentReportsQuery extends FulfillmentQuery {
  @ValidateIf((_, value) => value !== undefined)
  @IsMongoId()
  after?: string;
}

export class DeliveryPeriodShiftDto implements DeliveryPeriodShift {
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  quoteSegment: number;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  hearts: number;

  @IsIn(PRICING_PERIODS)
  targetPeriod: PricingPeriod;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  targetUnitPriceCents: number;
}
