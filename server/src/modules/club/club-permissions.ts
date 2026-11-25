export const CLUB_PERMISSIONS = [
  'CLUB_ORDERS_READ',
  'CLUB_MEMBERS_MANAGE',
  'CLUB_COMMISSION_MANAGE',
  'CLUB_FINANCE_READ',
] as const;

export type ClubPermission = (typeof CLUB_PERMISSIONS)[number];

export const CLUB_OPERATION_PERMISSIONS = [
  'CLUB_MEMBERS_MANAGE',
  'CLUB_COMMISSION_MANAGE',
] as const satisfies readonly ClubPermission[];

export function isClubOperationPermission(permission: ClubPermission) {
  return CLUB_OPERATION_PERMISSIONS.some((operation) => operation === permission);
}
