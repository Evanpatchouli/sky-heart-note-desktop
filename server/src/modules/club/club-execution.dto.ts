import { Matches } from 'class-validator';

export class LinkGameAccountDto {
  @Matches(/^[a-f0-9]{32}$/)
  personalAccountId: string;
}
