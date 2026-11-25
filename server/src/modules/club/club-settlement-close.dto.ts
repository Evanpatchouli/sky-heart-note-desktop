import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { settlementCashMovementLabel, type SettlementCashMovementKind } from '@webapp-template/common';

export class CloseGiftSettlementDto {
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID('4')
  requestId: string;

  @Matches(/^[a-f0-9]{64}$/)
  calculationId: string;
}

export class RequestSettlementCashCorrectionDto {
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID('4')
  requestId: string;

  @IsString()
  @Matches(/\S/)
  @MaxLength(160)
  movementRequestId: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(Object.keys(settlementCashMovementLabel))
  movementKind?: SettlementCashMovementKind;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision: number;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  correctedAmountCents: number;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Matches(/\S/)
  @MaxLength(1000)
  evidence: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  reason: string;
}
