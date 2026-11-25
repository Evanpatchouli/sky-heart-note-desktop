import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { AdminGiftSettlement, CustomerGiftSettlement, GiftSettlementCalculation, GiftSettlementRow, PersonalGiftSettlement } from '@webapp-template/common';
import { Model, Types, type QueryFilter } from 'mongoose';
import type { SessionUser } from '../../auth/app-access';
import { ClubDailyReportStore, reportObjectId } from './club-daily-report.store';
import { DailyReport } from './club-delivery.schema';
import { ClubDirectoryService } from './club-directory.service';
import { ClubFinancialAdjustment } from './club-financial-adjustment.schema';
import { ClubFinancialAdjustmentService } from './club-financial-adjustment.service';
import { giftDayFacts } from './club-gift-delivery';
import { hasConfirmedMemberPenalty, personalPenalty } from './club-gift-settlement-adjustments';
import { calculateGiftSettlement, GIFT_SETTLEMENT_CALCULATION_VERSION } from './club-gift-settlement';
import { customerGiftTermination } from './club-gift-termination';
import type { ClubOrderQuery } from './club-order.dto';
import { ClubOrder } from './club-order.schema';
import { ClubSettlementEvidenceService } from './club-settlement-evidence.service';
import { closeView, financeCorrectionView, revisedCouponState, settlementCouponChange, settlementPostings, type StoredSettlementClose } from './club-settlement-close';
import { effectiveSettlementCash } from './club-settlement-cash';
import { CLUB_ID } from './club.schema';
import type { CloseGiftSettlementDto } from './club-settlement-close.dto';

export const giftSettlementOrders: QueryFilter<ClubOrder>[] = [
  { dispatchStatus: 'published', 'dispatchPricing.priceUnit': 'gift_times' },
  { dispatchStatus: { $in: ['draft', 'pending'] }, 'receipt.quote.priceUnit': 'gift_times', 'giftTermination.id': { $exists: true } },
];

@Injectable()
export class ClubGiftSettlementService {
  constructor(
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    @InjectModel(DailyReport.name) private readonly reports: Model<DailyReport>,
    @InjectModel(ClubFinancialAdjustment.name) private readonly financialAdjustments: Model<ClubFinancialAdjustment>,
    private readonly directory: ClubDirectoryService,
    private readonly dailyReports: ClubDailyReportStore,
    private readonly evidence: ClubSettlementEvidenceService,
    private readonly adjustmentWriter: ClubFinancialAdjustmentService,
  ) {}

  async close(clubId: string, userId: string, orderId: string, input: CloseGiftSettlementDto) {
    await this.directory.requireMember(clubId, userId);
    const id = reportObjectId(orderId);
    const scope = { $or: giftSettlementOrders, _id: id, clubId, dispatcherUserId: userId };
    const replay = (order: ClubOrder) => {
      if (!order.closedAt) return null;
      const saved = closeView(order.settlementClose);
      if (saved?.requestId === input.requestId && saved.calculationId === input.calculationId) return saved;
      throw new ConflictException('本单已确认结单');
    };
    const existing = await this.orders.findOne(scope).readConcern('majority').lean();
    if (!existing) throw new NotFoundException('本单不存在或不归您经办');
    const repeated = replay(existing);
    if (repeated) return repeated;
    const { order, calculation, finalCalculation } = await this.current(scope);
    const concurrent = replay(order);
    if (concurrent) return concurrent;
    if (calculation.status !== 'ready_to_close' || finalCalculation?.id !== input.calculationId) {
      throw new ConflictException('本单的实绩或款项已变化，请重新核对计算单');
    }
    const frozen = await this.evidence.read<GiftSettlementCalculation>(clubId, id, input.calculationId);
    const basis = frozen.calculation;
    if (frozen.finalCalculation.version !== GIFT_SETTLEMENT_CALCULATION_VERSION ||
      basis.clubId !== clubId || basis.orderId !== orderId.toLowerCase() ||
      basis.dispatcherUserId !== userId || basis.status !== 'ready_to_close' || basis.totals.differenceCents !== 0) {
      throw new ConflictException('计算单与本单当前结算依据不符');
    }
    const penalties = basis.adjustments?.filter(hasConfirmedMemberPenalty) ?? [];
    const closedAt = new Date(penalties.reduce((time, penalty) => Math.max(time, Date.parse(penalty.decidedAt)), Date.now()));
    const close: StoredSettlementClose = {
      status: 'closed', closedAt: closedAt.toISOString(), closedByUserId: userId,
      ...input, calculationVersion: frozen.finalCalculation.version, postings: settlementPostings(basis),
    };
    await this.directory.requireMember(clubId, userId);
    const result = await this.orders.updateOne({
      ...scope, closedAt: null, pendingDailyReport: null, pendingFinancialAdjustment: null,
      fulfillmentRevision: order.fulfillmentRevision ?? { $in: [null, 0] },
      continuationRevision: order.continuationRevision ?? { $in: [null, 0] },
      financialRevision: order.financialRevision ?? { $in: [null, 0] },
    }, { $set: {
      closedAt, settlementClose: close, settlementPenaltyIds: penalties.map(penalty => new Types.ObjectId(penalty.id)),
    } }, { writeConcern: { w: 'majority', j: true } });
    if (result.modifiedCount) return closeView(close)!;
    const latest = await this.orders.findOne(scope).readConcern('majority').lean();
    const committed = latest && replay(latest);
    if (committed) return committed;
    throw new ConflictException('本单正在更新，请刷新后重新核对');
  }

  async adminList(clubId: string, actor: SessionUser, query: ClubOrderQuery) {
    await this.directory.requireAdminPermission(clubId, actor, 'CLUB_FINANCE_READ');
    const limit = query.limit ?? 25;
    const orders = await this.orders.find({
      $or: giftSettlementOrders, clubId,
      ...(query.source ? { source: query.source } : {}),
      ...(query.after ? { _id: { $lt: reportObjectId(query.after) } } : {}),
    }).select({ _id: 1 }).sort({ _id: -1 }).limit(limit + 1).lean();
    const items = await Promise.all(orders.slice(0, limit).map(order => this.row(clubId, order._id)));
    return { items, nextCursor: orders.length > limit ? items.at(-1)!.orderId : null };
  }

  async row(clubId: string, id: Types.ObjectId): Promise<GiftSettlementRow> {
    const { order, calculation, finalCalculation } = await this.current({ $or: giftSettlementOrders, _id: id, clubId });
    const { priceUnit, orderId, source, publishedAt, agreedGiftTimes, status } = calculation;
    return { priceUnit, orderId, source, publishedAt, agreedGiftTimes, status, finalCalculation, close: closeView(order.settlementClose) };
  }

  async adminDetail(clubId: string, actor: SessionUser, orderId: string): Promise<AdminGiftSettlement> {
    await this.directory.requireAdminPermission(clubId, actor, 'CLUB_FINANCE_READ');
    const id = reportObjectId(orderId);
    const { order, calculation, finalCalculation } = await this.current({ $or: giftSettlementOrders, _id: id, clubId });
    const [previousCalculation, memberNames] = await Promise.all([
      this.evidence.latest(clubId, id, finalCalculation?.id, order.closedAt), this.memberNames(calculation),
    ]);
    return { ...calculation, finalCalculation, previousCalculation, memberNames, close: closeView(order.settlementClose),
      corrections: order.settlementCorrections?.map(financeCorrectionView) };
  }

  async historical(clubId: string, actor: SessionUser, orderId: string, id: string): Promise<AdminGiftSettlement> {
    await this.directory.requireAdminPermission(clubId, actor, 'CLUB_FINANCE_READ');
    const { calculation, finalCalculation } = await this.evidence.read<GiftSettlementCalculation>(clubId, reportObjectId(orderId), id);
    return { ...calculation, finalCalculation, previousCalculation: null, memberNames: await this.memberNames(calculation) };
  }

  async personal(clubId: string, userId: string, orderId: string): Promise<PersonalGiftSettlement> {
    await this.directory.requireMember(clubId, userId);
    const { order, calculation, finalCalculation } = await this.current({
      _id: reportObjectId(orderId), clubId,
      $and: [{ $or: giftSettlementOrders }],
      $or: [{ dispatcherUserId: userId }, { 'giftDispatch.segments.shares.userId': userId }],
    });
    const { priceUnit, status, stopped, totals, planned, termination } = calculation;
    const isDispatcher = calculation.dispatcherUserId === userId;
    const own = calculation.members.find(member => member.userId === userId);
    const member = own ? this.memberView(own) : null;
    const penalties = !own ? calculation.adjustments?.filter(record =>
      record.memberUserId === userId && hasConfirmedMemberPenalty(record),
    ).map(personalPenalty) : undefined;
    return {
      priceUnit, status, stopped, finalCalculation, member,
      ...(isDispatcher ? { canClose: status === 'ready_to_close', close: closeView(order.settlementClose) } : {}),
      ...(penalties?.length ? { penalties } : {}),
      ...(isDispatcher && termination ? { termination } : {}),
      dispatch: isDispatcher ? {
        feeCents: totals.dispatchFeeCents, personalDiscountCents: totals.personalDiscountCents, netCents: totals.dispatchNetCents,
        plannedFeeCents: planned.dispatchFeeCents, plannedPersonalDiscountCents: planned.personalDiscountCents,
        plannedNetCents: planned.dispatchNetCents,
      } : null,
    };
  }

  private memberView({ userId: _id, segments, ...member }: GiftSettlementCalculation['members'][number]): NonNullable<PersonalGiftSettlement['member']> {
    return {
      ...member,
      segments: segments.map(({ grossCents: _gross, dispatchFeeCents: _dispatch, clubFeeCents: _club, ...segment }) => segment),
    };
  }

  async customer(clubId: string, userId: string, orderId: string): Promise<CustomerGiftSettlement | undefined> {
    const scope: QueryFilter<ClubOrder> = {
      $or: giftSettlementOrders, _id: reportObjectId(orderId), clubId,
      customerUserId: userId, customerLinkStatus: 'verified',
    };
    if (!await this.orders.exists(scope)) return undefined;
    const { order, calculation: { status, cash, termination } } = await this.current(scope, false);
    const cashCorrected = order.settlementCorrections?.some(row => row.kind === 'cash' && row.status === 'approved');
    return { status, cash, closedAt: order.closedAt?.toISOString(), ...(cashCorrected ? { cashCorrected } : {}),
      ...(termination ? { termination: customerGiftTermination(termination) } : {}) };
  }

  async prepareReportCorrection(order: ClubOrder, report: DailyReport, decidedAt: string) {
    const [source, revisedFacts] = await Promise.all([
      this.source(order), giftDayFacts(this.reports.collection, order, undefined, undefined, undefined, report),
    ]);
    const original = calculateGiftSettlement(order, source.facts, source.reports, source.adjustments);
    const revisedOrder = { ...order, fulfillmentRevision: (order.fulfillmentRevision ?? 0) + 1 };
    const reports = [...source.reports, report];
    const updated = calculateGiftSettlement(revisedOrder, revisedFacts, reports, source.adjustments);
    const couponChange = settlementCouponChange(order, original, updated, decidedAt);
    Object.assign(revisedOrder, revisedCouponState(couponChange));
    const revised = couponChange ? calculateGiftSettlement(revisedOrder, revisedFacts, reports, source.adjustments) : updated;
    if (revised.issues.some(issue => ['amount_overflow', 'invalid_fulfillment', 'negative_reward'].includes(issue)))
      throw new ConflictException('日报更正无法按原报价核算，请核对更正内容');
    const calculation = await this.save(order, effectiveSettlementCash(revisedOrder, revised));
    return { calculation, original, revised, couponChange };
  }

  closedForCorrection(id: Types.ObjectId) {
    return this.current({ _id: id, clubId: CLUB_ID, 'settlementClose.calculationId': { $exists: true } }, false, false);
  }

  private async current(scope: QueryFilter<ClubOrder>, persist = true, includeCashCorrections = true) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const order = await this.orders.findOne(scope).readConcern('majority').lean();
      if (!order) throw new NotFoundException('该已派发按次订单不存在');
      if (order.pendingFinancialAdjustment) {
        await this.adjustmentWriter.flushOrderAdjustment(order);
        continue;
      }
      if (order.pendingDailyReport) {
        await this.dailyReports.flushPendingReport(order);
        continue;
      }
      const adjustmentScope = { clubId: order.clubId, orderId: order._id };
      const { facts, reports, adjustments } = await this.source(order);
      const [latest, revisions] = await Promise.all([
        this.orders.findOne(scope).select({
          fulfillmentRevision: 1, continuationRevision: 1, pendingDailyReport: 1,
          financialRevision: 1, pendingFinancialAdjustment: 1, settlementCorrectionRevision: 1, closedAt: 1,
        }).readConcern('majority').lean(),
        this.financialAdjustments.find(adjustmentScope).select({ _id: 1, revision: 1 }).sort({ _id: 1 }).lean(),
      ]);
      if (!latest) throw new NotFoundException('该已派发按次订单不存在');
      if (order.fulfillmentRevision !== latest.fulfillmentRevision || order.continuationRevision !== latest.continuationRevision ||
        order.financialRevision !== latest.financialRevision || latest.pendingFinancialAdjustment ||
        order.settlementCorrectionRevision !== latest.settlementCorrectionRevision ||
        order.closedAt?.getTime() !== latest.closedAt?.getTime() || latest.pendingDailyReport ||
        adjustments.length !== revisions.length ||
        adjustments.some((item, idx) => !item._id.equals(revisions[idx]._id) || item.revision !== revisions[idx].revision)) continue;
      const rawCalculation = calculateGiftSettlement(order, facts, reports, adjustments);
      const calculation = includeCashCorrections ? effectiveSettlementCash(order, rawCalculation) : rawCalculation;
      const finalCalculation = persist && order.settlementClose ? (await this.evidence.read<GiftSettlementCalculation>(
        order.clubId, order._id, order.settlementClose.calculationId,
      )).finalCalculation : persist && calculation.status === 'ready_to_close' ? await this.save(order, calculation) : null;
      return { order, calculation, finalCalculation };
    }
    throw new ConflictException('订单实绩或款项正在更新，请刷新后重新核对');
  }

  private async source(order: ClubOrder) {
    const shareIds = order.giftDispatch?.segments.flatMap(segment => segment.shares.map(share => new Types.ObjectId(share.id))) ?? [];
    const [facts, reports, adjustments] = await Promise.all([
      giftDayFacts(this.reports.collection, order),
      this.reports.find({
        orderId: order._id,
        $or: [{ priceUnit: 'gift_times' },
          { priceUnit: null, $or: [{ shareId: { $in: shareIds } }, { 'lines.shareId': { $in: shareIds } }] }],
      }).sort({ _id: 1 }).lean(),
      this.financialAdjustments.find({ clubId: order.clubId, orderId: order._id }).sort({ _id: 1 }).readConcern('majority').lean(),
    ]);
    return { facts, reports, adjustments };
  }

  private save(order: ClubOrder, { adjustments, ...basis }: GiftSettlementCalculation) {
    const confirmed = adjustments?.filter(item => item.status === 'approved');
    return this.evidence.save(order.clubId, order._id, GIFT_SETTLEMENT_CALCULATION_VERSION, {
      ...basis,
      continuations: basis.continuations.filter(quote => quote.receipt),
      priceAdjustments: basis.priceAdjustments.filter(change => change.newQuoteSegment || change.state === 'stopped'),
      ...(confirmed?.length ? { adjustments: confirmed } : {}),
    });
  }

  private async memberNames(calculation: GiftSettlementCalculation) {
    const ids = new Set([calculation.dispatcherUserId, ...calculation.members.map(member => member.userId)]);
    if (calculation.receipt) ids.add(calculation.receipt.receivedByUserId);
    for (const adjustment of calculation.adjustments ?? []) {
      if (adjustment.memberUserId) ids.add(adjustment.memberUserId);
      if (adjustment.decidedByUserId) ids.add(adjustment.decidedByUserId);
    }
    return Object.fromEntries(await this.directory.memberNicknames([...ids]));
  }
}
