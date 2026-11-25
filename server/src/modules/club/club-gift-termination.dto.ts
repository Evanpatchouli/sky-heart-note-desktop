import { Transform } from 'class-transformer';
import { Equals, IsInt, IsISO8601, IsMongoId, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const trim = Transform(({ value }) => typeof value === 'string' ? value.trim() : value);

class GiftTerminationRequestIdDto {
  @IsUUID('4')
  requestId: string;
}

export class RequestGiftTerminationDto extends GiftTerminationRequestIdDto {
  @Equals(true)
  confirmed: true;

  @ValidateIf((_, value) => value !== undefined && value !== '')
  @trim
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  reason?: string;
}

export class RecordGiftTerminationChangeDto extends GiftTerminationRequestIdDto {
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision: number;

  @trim
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  reason: string;

  @ValidateIf((_, value) => value !== undefined)
  @trim
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  customerRequestReference?: string;
}

export class RecordGiftTerminationRefundDto extends GiftTerminationRequestIdDto {
  @IsMongoId()
  terminationId: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision: number;

  @Equals(true)
  confirmed: true;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountCents: number;

  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/)
  occurredAt: string;
}
