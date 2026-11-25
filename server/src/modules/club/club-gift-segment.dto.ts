import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsInt, IsObject, IsString, Matches, Max, Min, ValidateNested,
} from 'class-validator';
import { USER_ID_PATTERN } from '@webapp-template/common';

export const giftBusinessDatePattern = /^\d{4}-\d{2}-\d{2}$/;

class GiftWindowDto {
  @IsString()
  @Matches(giftBusinessDatePattern)
  startDate: string;

  @IsString()
  @Matches(giftBusinessDatePattern)
  endDate: string;
}

class GiftDirectedDto extends GiftWindowDto {
  @Matches(USER_ID_PATTERN)
  userId: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  dailyGiftTimes: number;
}

export class GiftDispatchSegmentDto extends GiftWindowDto {
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  segmentIndex: number;

  @IsBoolean()
  openToClaim: boolean;

  @IsArray()
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => GiftDirectedDto)
  directed: GiftDirectedDto[];
}
