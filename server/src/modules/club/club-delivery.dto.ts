import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PRICING_PERIODS } from '@webapp-template/common';

export const OBSERVED_PERIODS = [...PRICING_PERIODS, 'unconfirmed'] as const;
export type ObservedPeriod = (typeof OBSERVED_PERIODS)[number];

class DailyReportLineDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsMongoId()
  shareId?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(OBSERVED_PERIODS)
  period?: ObservedPeriod;

  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  quoteSegment?: number;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  giftTimes: number;

  @ValidateIf((_, value) => value != null)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  receivedHearts?: number | null;
}

class ReportObservationDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID('4')
  requestId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DailyReportLineDto)
  lines: DailyReportLineDto[];
}

export class CreateDailyReportDto extends ReportObservationDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  businessDate: string;

  @IsIn(['daily', 'supplement'])
  kind: 'daily' | 'supplement';

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf(
    (input: CreateDailyReportDto, value) =>
      input.kind === 'supplement' || value !== undefined,
  )
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  reason?: string;
}

export class CreateReportCorrectionDto extends ReportObservationDto {
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER - 1)
  expectedVersion: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  reason: string;
}
