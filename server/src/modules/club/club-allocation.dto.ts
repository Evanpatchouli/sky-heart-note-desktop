import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { USER_ID_PATTERN } from '@webapp-template/common';
import { GiftDispatchSegmentDto } from './club-gift-segment.dto';

class AllocationRequest {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID('4')
  requestId: string;
}

class DirectedShareDto {
  @Matches(USER_ID_PATTERN)
  userId: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  hearts: number;
}

export class PublishOrderDto extends AllocationRequest {
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  pricingRevision: number;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  ruleVersion: number;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  commissionReviewRevision: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => GiftDispatchSegmentDto)
  giftDispatchSegments?: GiftDispatchSegmentDto[];

  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  publicHearts?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => DirectedShareDto)
  directed?: DirectedShareDto[];
}

export const CLAIM_KINDS = ['public', 'directed'] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export class ClaimOrderDto extends AllocationRequest {
  @IsIn(CLAIM_KINDS)
  kind: ClaimKind;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  hearts: number;
}
