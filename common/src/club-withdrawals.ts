export type ClubWithdrawal = {
  id: string;
  requestId: string;
  memberUserId: string;
  requestedAt: string;
  amountCents: number;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  decidedByUserId?: string;
  decidedAt?: string;
  payments: {
    requestId: string;
    amountCents: number;
    occurredAt: string;
    recordedByUserId: string;
    transferReference?: string;
  }[];
};
