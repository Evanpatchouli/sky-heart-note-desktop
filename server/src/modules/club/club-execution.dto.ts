import { IsDateString, IsIn, Matches, ValidateIf } from 'class-validator';

export const ACCOUNT_RELATIONSHIPS = ['existing_friend', 'new_unlock'] as const;
export type AccountRelationship = (typeof ACCOUNT_RELATIONSHIPS)[number];

export class LinkGameAccountDto {
  @Matches(/^[a-f0-9]{32}$/)
  personalAccountId: string;
}

export class RecordAccountRelationshipDto {
  @IsIn(ACCOUNT_RELATIONSHIPS)
  relationship: AccountRelationship;

  @ValidateIf((_, value) => value !== undefined)
  @IsDateString({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  occurredAt?: string;
}
