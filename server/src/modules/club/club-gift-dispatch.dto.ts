import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDefined, IsIn, IsInt, IsMongoId, IsObject, Matches, Max, Min, ValidateIf,
  ValidateNested,
} from 'class-validator';
import { USER_ID_PATTERN } from '@webapp-template/common';
import { OrderRequestDto } from './club-order.dto';

import { GiftDispatchSegmentDto } from './club-gift-segment.dto';

export class ConfigureGiftDispatchDto extends OrderRequestDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => GiftDispatchSegmentDto)
  segments: GiftDispatchSegmentDto[];
}

export class ClaimGiftDispatchDto extends OrderRequestDto {
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  segmentIndex: number;

  @IsIn(['public', 'directed'])
  kind: 'public' | 'directed';

  @ValidateIf(input => input.kind === 'public' || input.dailyGiftTimes !== undefined)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  dailyGiftTimes?: number;

  @ValidateIf(input => input.kind === 'directed' || input.offerId !== undefined)
  @IsDefined()
  @IsMongoId()
  offerId?: string;

  @ValidateIf(input => input.actualReceivedHearts !== undefined)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  actualReceivedHearts?: number;
}

export class ReassignGiftDispatchDto extends OrderRequestDto {
  @IsMongoId()
  shareId: string;

  @Matches(USER_ID_PATTERN)
  userId: string;

  @ValidateIf(input => input.giftTimes !== undefined)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  giftTimes?: number;
}
