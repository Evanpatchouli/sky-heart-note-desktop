import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { GiftReportLine, GiftSettlementCalculation, SettlementCorrection, SettlementCorrectionCouponChange } from '@webapp-template/common';
import { createHash } from 'node:crypto';
import { Model } from 'mongoose';
import { isDuplicateKey } from '../user-module/user-id';
import { ClubDailyReportStore, reportObjectId } from './club-daily-report.store';
import type { CreateReportCorrectionDto } from './club-delivery.dto';
import type { DailyReport } from './club-delivery.schema';
import { ClubDirectoryService } from './club-directory.service';
import type { DecideClubAdjustmentDto } from './club-financial-adjustment.dto';
import { ClubGiftDeliveryService } from './club-gift-delivery.service';
import { ClubGiftSettlementService } from './club-gift-settlement.service';
import { ClubOrder } from './club-order.schema';
import { cashMovements, effectiveSettlementCash } from './club-settlement-cash';
import { correctionView, financeCorrectionView, revisedCouponState, settlementPostings, type OrderSettlementPosting } from './club-settlement-close';
import type { RequestSettlementCashCorrectionDto } from './club-settlement-close.dto';
import { CLUB_ID } from './club.schema';

const durable = { writeConcern: { w: 'majority', j: true } } as const;
type StoredRequest = { requestHash: string; proposedReport?: DailyReport; couponChange?: SettlementCorrectionCouponChange };
export type StoredSettlementCorrection = SettlementCorrection & StoredRequest;

@Injectable()
export class ClubSettlementCorrectionService {
  constructor(
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    private readonly directory: ClubDirectoryService,
    private readonly delivery: ClubGiftDeliveryService,
    private readonly reports: ClubDailyReportStore,
    private readonly settlements: ClubGiftSettlementService,
  ) {}

  async requestReport(userId: string, orderId: string, reportId: string, input: CreateReportCorrectionDto) {
    await this.directory.requireMember(CLUB_ID, userId);
    const order = await this.closedOrder(orderId);
    const target = reportObjectId(reportId).toHexString();
    const requestHash = this.hash(['daily_report', target, input.expectedVersion, input.reason,
      input.lines.map(line => [line.shareId, line.quoteSegment, line.period, line.giftTimes, line.receivedHearts ?? null])]);
    const prior = this.replay(order, userId, input.requestId, requestHash);
    if (prior) return prior;
    const { report, previous } = await this.delivery.submit(CLUB_ID, userId, orderId, { ...input, kind: 'correction', reportId: target }, true);
    if (order.settlementCorrections?.some(row => row.kind === 'daily_report' && row.originalReportId === target && row.status === 'pending'))
      throw new ConflictException('该日报已有待确认的更正申请');
    return this.append(order, {
      ...this.requestFields(order, userId, input, requestHash),
      kind: 'daily_report', originalReportId: target, priorReportId: previous._id.toHexString(),
      expectedVersion: previous.version, businessDate: report.businessDate, previousLines: this.lines(previous),
      lines: this.lines(report), proposedReport: report,
    });
  }

  async listReport(userId: string, orderId: string, reportId: string) {
    const order = await this.delivery.orderForMember(CLUB_ID, userId, orderId);
    const target = reportObjectId(reportId).toHexString();
    return { records: (order.settlementCorrections ?? []).filter(row =>
      row.kind === 'daily_report' && row.originalReportId === target && row.requestedByUserId === userId,
    ).map(correctionView) };
  }

  async cash(userId: string, orderId: string) {
    await this.directory.requireMember(CLUB_ID, userId);
    const order = await this.closedOrder(orderId, userId);
    const { calculation, order: latest } = await this.settlements.closedForCorrection(order._id);
    return { movements: cashMovements(latest, calculation.adjustments),
      records: (latest.settlementCorrections ?? []).filter(row => row.kind === 'cash').map(correctionView) };
  }

  async requestCash(userId: string, orderId: string, input: RequestSettlementCashCorrectionDto) {
    await this.directory.requireMember(CLUB_ID, userId);
    const order = await this.closedOrder(orderId, userId);
    const { calculation, order: latest } = await this.settlements.closedForCorrection(order._id);
    const requestHash = this.hash(['cash', input.movementRequestId, input.movementKind,
      input.expectedRevision, input.correctedAmountCents, input.reason, input.evidence]);
    const prior = this.replay(latest, userId, input.requestId, requestHash);
    if (prior) return prior;
    const candidates = cashMovements(latest, calculation.adjustments).filter(item =>
      item.requestId === input.movementRequestId && (!input.movementKind || item.kind === input.movementKind));
    if (candidates.length > 1) throw new ConflictException('该流水号用于多类款项，请选择具体收退款类别');
    const [movement] = candidates;
    if (!movement) throw new NotFoundException('本单没有该实收或实退记录');
    if (movement.revision !== input.expectedRevision || movement.effectiveAmountCents === input.correctedAmountCents)
      throw new ConflictException('原金额已更新或更正金额没有变化，请重新核对');
    if (latest.settlementCorrections?.some(row => row.kind === 'cash' && row.movement.requestId === movement.requestId &&
      row.movement.kind === movement.kind && row.status === 'pending'))
      throw new ConflictException('该笔收退款已有待确认的更正申请');
    return this.append(latest, {
      ...this.requestFields(latest, userId, input, requestHash),
      kind: 'cash', movement, correctedAmountCents: input.correctedAmountCents, evidence: input.evidence,
    });
  }

  async listApprovals(userId: string) {
    await this.requireLeadership(userId);
    const orders = await this.orders.find({ clubId: CLUB_ID, 'settlementCorrections.status': 'pending' })
      .select({ settlementCorrections: 1 }).readConcern('majority').lean();
    const records = orders.flatMap(order => (order.settlementCorrections ?? [])
      .filter(row => row.status === 'pending').map(correctionView))
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
    return { records, memberNames: Object.fromEntries(await this.directory.memberNicknames([...new Set(records.map(row => row.requestedByUserId))])) };
  }

  async decide(userId: string, orderId: string, requestId: string, input: DecideClubAdjustmentDto) {
    await this.requireLeadership(userId);
    if (input.expectedRevision !== 1) throw new ConflictException('更正申请状态已更新，请刷新后核对');
    const replay = (row: StoredSettlementCorrection) => {
      if (row.status === 'pending') return null;
      if (row.status === input.decision && row.decidedByUserId === userId && row.decisionReason === input.reason)
        return financeCorrectionView(row);
      throw new ConflictException('更正申请已处理');
    };
    for (let attempt = 0; attempt < 5; attempt++) {
      const order = await this.closedOrder(orderId);
      const { order: latest, calculation } = await this.settlements.closedForCorrection(order._id);
      const rows = latest.settlementCorrections ?? [];
      const index = rows.findIndex(row => row.requestId === requestId);
      if (index === -1) throw new NotFoundException('本单没有该更正申请');
      const row = rows[index];
      const repeated = replay(row);
      if (repeated) return repeated;
      const decided = { status: input.decision, decidedAt: new Date().toISOString(), decidedByUserId: userId,
        ...(input.reason ? { decisionReason: input.reason } : {}) };
      let approved: StoredSettlementCorrection = { ...row, ...decided };
      let report: DailyReport | undefined;
      let couponChange: SettlementCorrectionCouponChange | undefined;
      if (input.decision === 'approved') {
        if (row.kind === 'daily_report') {
          const prepared = await this.delivery.submit(CLUB_ID, row.requestedByUserId, orderId, {
            requestId: row.requestId, kind: 'correction', reportId: row.originalReportId,
            expectedVersion: row.expectedVersion, lines: row.lines, reason: row.reason,
          }, true);
          report = { ...prepared.report, _id: row.proposedReport!._id, submittedAt: row.proposedReport!.submittedAt,
            requestHash: row.proposedReport!.requestHash };
          if (prepared.previous._id.toHexString() !== row.priorReportId)
            throw new ConflictException('原日报版本已更新，请重新申请');
          const revised = await this.settlements.prepareReportCorrection(latest, report, decided.decidedAt);
          couponChange = revised.couponChange;
          approved = { ...row, ...decided, approvedReportId: report._id.toHexString(), approvedVersion: report.version,
            revisedCalculationId: revised.calculation!.id, postings: this.difference(revised.original, revised.revised),
            ...(couponChange ? { couponChange } : {}) };
        } else {
          const movement = cashMovements(latest, calculation.adjustments)
            .find(item => item.requestId === row.movement.requestId && item.kind === row.movement.kind);
          if (movement?.revision !== row.movement.revision)
            throw new ConflictException('原实收或实退已更新，请重新申请');
          approved = { ...row, ...decided, deltaCents: row.correctedAmountCents - movement.effectiveAmountCents,
            eventId: `club.settlement.cash:${latest._id.toHexString()}:${row.requestId}` };
        }
      }
      const updated = rows.with(index, approved);
      if (approved.kind === 'cash' && approved.status === 'approved')
        effectiveSettlementCash({ ...latest, settlementCorrections: updated }, calculation);
      await this.requireLeadership(userId);
      const { activePromotionCouponId, promotionCouponReturnedAt } = revisedCouponState(couponChange);
      const couponUpdate = activePromotionCouponId ? { activePromotionCouponId }
        : promotionCouponReturnedAt ? { promotionCouponReturnedAt } : {};
      const removedCouponField = couponChange ? (activePromotionCouponId ? 'promotionCouponReturnedAt' : 'activePromotionCouponId') : undefined;
      const saved = await this.orders.updateOne(this.scope(latest), {
        $set: { settlementCorrections: updated, ...couponUpdate, ...(report ? { pendingDailyReport: report } : {}) },
        ...(removedCouponField ? { $unset: { [removedCouponField]: 1 } } : {}),
        $inc: { settlementCorrectionRevision: 1, ...(report ? { fulfillmentRevision: 1 } : {}) },
      }, durable).catch(error => {
        if (isDuplicateKey(error, 'activePromotionCouponId'))
          throw new ConflictException('原优惠券已被另一笔订单使用，确认更正前须先核定优惠归属');
        throw error;
      });
      if (!saved.modifiedCount) continue;
      if (report) await this.reports.flushPendingReport({ _id: latest._id, pendingDailyReport: report });
      return financeCorrectionView(approved);
    }
    throw new ConflictException('本单正在更新，请重试更正确认');
  }

  private async append(order: ClubOrder, request: StoredSettlementCorrection) {
    const result = await this.orders.updateOne(this.scope(order), {
      $push: { settlementCorrections: request }, $inc: { settlementCorrectionRevision: 1 },
    }, durable);
    if (result.modifiedCount) return correctionView(request);
    const latest = await this.closedOrder(order._id.toHexString());
    const recovered = this.replay(latest, request.requestedByUserId, request.requestId, request.requestHash);
    if (recovered) return recovered;
    throw new ConflictException('本单的依据已更新，请刷新后重新申请');
  }

  private scope(order: ClubOrder) {
    return {
      _id: order._id, clubId: CLUB_ID, 'settlementClose.calculationId': order.settlementClose!.calculationId,
      settlementCorrectionRevision: order.settlementCorrectionRevision ?? { $in: [null, 0] },
      fulfillmentRevision: order.fulfillmentRevision ?? { $in: [null, 0] },
      financialRevision: order.financialRevision ?? { $in: [null, 0] },
      pendingDailyReport: null, pendingFinancialAdjustment: null,
    };
  }

  private async closedOrder(orderId: string, dispatcherUserId?: string) {
    const order = await this.orders.findOne({ _id: reportObjectId(orderId), clubId: CLUB_ID,
      ...(dispatcherUserId ? { dispatcherUserId } : {}), 'settlementClose.calculationId': { $exists: true },
    }).readConcern('majority').lean();
    if (!order) throw new NotFoundException('本单尚未结单或不归您经办');
    return order;
  }

  private async requireLeadership(userId: string) {
    const club = await this.directory.getEmployeeClub(userId);
    if (!club?.canDecideAdjustments) throw new ForbiddenException('仅本团团长或副团长可确认更正');
  }

  private replay(order: ClubOrder, userId: string, requestId: string, hash: string) {
    const previous = order.settlementCorrections?.find(row => row.requestId === requestId);
    if (!previous) return null;
    if (previous.requestedByUserId !== userId || previous.requestHash !== hash)
      throw new ConflictException('该提交编号已用于另一笔更正申请');
    return correctionView(previous);
  }

  private requestFields(order: ClubOrder, userId: string, input: { requestId: string; reason: string }, requestHash: string) {
    return { requestId: input.requestId, reason: input.reason, requestHash, status: 'pending' as const,
      orderId: order._id.toHexString(), calculationId: order.settlementClose!.calculationId,
      requestedByUserId: userId, requestedAt: new Date().toISOString() };
  }

  private lines(report: DailyReport): GiftReportLine[] {
    return report.lines.map(({ shareId, quoteSegment, period, giftTimes, receivedHearts }) => ({
      shareId: (shareId ?? report.shareId).toHexString(), quoteSegment, period: period ?? 'unconfirmed', giftTimes, receivedHearts: receivedHearts ?? null,
    }));
  }

  private hash(basis: unknown[]) {
    return createHash('sha256').update(JSON.stringify(basis)).digest('hex');
  }

  private difference(original: GiftSettlementCalculation, revised: GiftSettlementCalculation): OrderSettlementPosting[] {
    const difference = new Map<string, OrderSettlementPosting>();
    for (const [basis, sign] of [[original, -1], [revised, 1]] as const) {
      for (const line of settlementPostings(basis)) {
        const key = `${line.kind}:${line.memberUserId ?? 'club'}`;
        const amountCents = (difference.get(key)?.amountCents ?? 0) + sign * line.amountCents;
        if (!Number.isSafeInteger(amountCents)) throw new ConflictException('更正差额超出安全整数范围');
        difference.set(key, { ...line, amountCents });
      }
    }
    return [...difference.values()].filter(line => line.amountCents !== 0);
  }
}
