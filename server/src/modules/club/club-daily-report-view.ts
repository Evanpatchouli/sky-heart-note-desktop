import type { DailyReport, DailyReportLine } from './club-delivery.schema';

export function jsonReportCount(value: bigint) {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
}

function timesOf(lines: readonly DailyReportLine[]) {
  return jsonReportCount(
    lines.reduce((total, { giftTimes }) => total + BigInt(giftTimes), 0n),
  );
}

export function dailyReportView(report: DailyReport, previous?: DailyReport, isGiftReport = report.priceUnit === 'gift_times') {
  const status = (version: DailyReport) => isGiftReport || version.kind === 'daily' ? 'recorded' as const : 'pending_review' as const;
  const lines = (version: DailyReport) => isGiftReport ? version.lines.map(line => ({
    ...line,
    shareId: (line.shareId ?? version.shareId).toHexString(),
    period: line.period ?? 'unconfirmed',
    receivedHearts: line.receivedHearts ?? null,
  })) : version.lines;
  return {
    id: report._id.toHexString(),
    priceUnit: isGiftReport ? 'gift_times' : 'received_hearts',
    ...(report.personalAccountId ? { personalAccountId: report.personalAccountId } : {}),
    ...(isGiftReport ? { orderId: report.orderId.toHexString(), memberNickname: report.memberNickname ?? null } : {}),
    originalId: report.originalId.toHexString(),
    userId: report.userId,
    shareId: report.shareId.toHexString(),
    accountId: report.accountId.toHexString(),
    accountName: report.accountName,
    accountLocalId: report.accountLocalId ?? null,
    recipientGameAccount: report.recipientGameAccount,
    businessDate: report.businessDate,
    submittedAt: report.submittedAt,
    kind: report.kind,
    version: report.version,
    status: status(report),
    reason: report.reason ?? null,
    lines: lines(report),
    giftTimes: timesOf(report.lines),
    receivedHearts: report.receivedHearts ?? null,
    checks: report.checks ?? [],
    previous: previous
      ? {
          version: previous.version,
          userId: previous.userId,
          submittedAt: previous.submittedAt,
          kind: previous.kind,
          status: status(previous),
          lines: lines(previous),
          giftTimes: timesOf(previous.lines),
          receivedHearts: previous.receivedHearts ?? null,
        }
      : null,
  };
}
