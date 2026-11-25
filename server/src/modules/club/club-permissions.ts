export const CLUB_PERMISSIONS = [
  'CLUB_ORDERS_READ',
  'CLUB_MEMBERS_MANAGE',
  'CLUB_COMMISSION_MANAGE',
  'CLUB_FINANCE_READ',
] as const;

export type ClubPermission = (typeof CLUB_PERMISSIONS)[number];

export function isClubPermission(value: string): value is ClubPermission {
  return CLUB_PERMISSIONS.some((permission) => permission === value);
}
