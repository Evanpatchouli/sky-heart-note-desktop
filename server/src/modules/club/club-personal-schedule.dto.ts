import { IsInt, IsISO8601, Matches, Max, Min, ValidateIf } from 'class-validator';
import { giftBusinessDatePattern } from './club-gift-segment.dto';

export class PersonalScheduleDto {
  @ValidateIf((_, value) => value !== null)
  @Matches(giftBusinessDatePattern)
  @IsISO8601({ strict: true })
  startDate: string | null;

  @ValidateIf((_, value) => value !== null)
  @Matches(giftBusinessDatePattern)
  @IsISO8601({ strict: true })
  endDate: string | null;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER - 1)
  expectedRevision: number;
}
