import { Transform } from 'class-transformer';
import {
  IsIn, IsInt, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf,
} from 'class-validator';
import { USER_ID_PATTERN } from '@webapp-template/common';

export class UpdateClubPromotionDto {
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER - 1)
  expectedVersion: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, 80)
  activityName?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(9_999)
  activityPayableBasisPoints?: number;

}

export class IssueClubCouponDto {
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID('4')
  requestId: string;

  @Transform(({ value }) => typeof value === 'string' ? value.toUpperCase() : value)
  @Matches(USER_ID_PATTERN)
  customerUserId: string;

  @IsString()
  @Length(1, 80)
  name: string;

  @IsIn(['rate_coupon', 'threshold_coupon'])
  kind: 'rate_coupon' | 'threshold_coupon';

  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(9_999)
  payableBasisPoints?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  thresholdCents?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  discountCents?: number;
}
