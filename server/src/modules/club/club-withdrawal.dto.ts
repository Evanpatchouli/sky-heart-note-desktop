import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import type { ClubWithdrawal } from '@sky-club/common';

export class RequestClubWithdrawalDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID()
  requestId: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountCents: number;
}

export class DecideClubWithdrawalDto {
  @IsIn(['approved', 'rejected'])
  decision: Extract<ClubWithdrawal['status'], 'approved' | 'rejected'>;
}

export class RecordClubWithdrawalPaymentDto extends RequestClubWithdrawalDto {
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/)
  occurredAt: string;

  @ValidateIf((_input: unknown, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  transferReference?: string;
}
