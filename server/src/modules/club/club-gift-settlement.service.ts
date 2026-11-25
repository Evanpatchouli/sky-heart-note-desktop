import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { AdminGiftSettlement, CustomerGiftSettlement, GiftSettlementCalculation, GiftSettlementRow, PersonalGiftSettlement } from '@webapp-template/common';
import { Model, Types, type QueryFilter } from 'mongoose';
import type { SessionUser } from '../../auth/app-access';
import { ClubDailyReportStore, reportObjectId } from './club-daily-report.store';
import { DailyReport } from './club-delivery.schema';
import { ClubDirectoryService } from './club-directory.service';
import { ClubFinancialAdjustment } from './club-financial-adjustment.schema';
import { giftDayFacts } from './club-gift-delivery';
import { hasConfirmedAdjustment, personalPenalty } from './club-gift-settlement-adjustments';
import { calculateGiftSettlement, GIFT_SETTLEMENT_CALCULATION_VERSION } from './club-gift-settlement';
import { customerGiftTermination } from './club-gift-termination';
import type { ClubOrderQuery } from './club-order.dto';
import { ClubOrder } from './club-order.schema';
import { ClubSettlementEvidenceService } from './club-settlement-evidence.service';

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
  ) {}

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
    const { calculation, finalCalculation } = await this.current({ $or: giftSettlementOrders, _id: id, clubId });
    const { priceUnit, orderId, source, publishedAt, agreedGiftTimes, status } = calculation;
    return { priceUnit, orderId, source, publishedAt, agreedGiftTimes, status, finalCalculation };
  }

  async adminDetail(clubId: string, actor: SessionUser, orderId: string): Promise<AdminGiftSettlement> {
    await this.directory.requireAdminPermission(clubId, actor, 'CLUB_FINANCE_READ');
    const id = reportObjectId(orderId);
    const { calculation, finalCalculation } = await this.current({ $or: giftSettlementOrders, _id: id, clubId });
    const [previousCalculation, memberNames] = await Promise.all([
      this.evidence.latest(clubId, id, finalCalculation?.id), this.memberNames(calculation),
    ]);
    return { ...calculation, finalCalculation, previousCalculation, memberNames };
  }

  async historical(clubId: string, actor: SessionUser, orderId: string, id: string): Promise<AdminGiftSettlement> {
    await this.directory.requireAdminPermission(clubId, actor, 'CLUB_FINANCE_READ');
    const { calculation, finalCalculation } = await this.evidence.read<GiftSettlementCalculation>(clubId, reportObjectId(orderId), id);
    return { ...calculation, finalCalculation, previousCalculation: null, memberNames: await this.memberNames(calculation) };
  }

  async personal(clubId: string, userId: string, orderId: string): Promise<PersonalGiftSettlement> {
    await this.directory.requireMember(clubId, userId);
    const { calculation, finalCalculation } = await this.current({
      _id: reportObjectId(orderId), clubId,
      $and: [{ $or: giftSettlementOrders }],
      $or: [{ dispatcherUserId: userId }, { 'giftDispatch.segments.shares.userId': userId }],
    });
    const { priceUnit, status, stopped, totals, planned, termination } = calculation;
    const isDispatcher = calculation.dispatcherUserId === userId;
    const own = calculation.members.find(member => member.userId === userId);
    const member = own ? this.memberView(own) : null;
    const penalties = !own ? calculation.adjustments?.filter(record =>
      record.kind === 'member_penalty' && record.memberUserId === userId && !record.refunds.length && hasConfirmedAdjustment(record),
    ).map(personalPenalty) : undefined;
    return {
      priceUnit, status, stopped, finalCalculation, member,
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
    const { calculation: { status, cash, termination } } = await this.current(scope, false);
    return { status, cash, ...(termination ? { termination: customerGiftTermination(termination) } : {}) };
  }

  private async current(scope: QueryFilter<ClubOrder>, persist = true) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const order = await this.orders.findOne(scope).lean();
      if (!order) throw new NotFoundException('该已派发按次订单不存在');
      if (order.pendingDailyReport) {
        await this.dailyReports.flushPendingReport(order);
        continue;
      }
      const shareIds = order.giftDispatch?.segments.flatMap(segment => segment.shares.map(share => new Types.ObjectId(share.id))) ?? [];
      const adjustmentScope = { clubId: order.clubId, orderId: order._id };
      const [facts, reports, adjustments] = await Promise.all([
        giftDayFacts(this.orders.db.collection('club_daily_reports'), order),
        this.reports.find({
          orderId: order._id,
          $or: [{ priceUnit: 'gift_times' },
            { priceUnit: null, $or: [{ shareId: { $in: shareIds } }, { 'lines.shareId': { $in: shareIds } }] }],
        }).sort({ _id: 1 }).lean(),
        this.financialAdjustments.find(adjustmentScope).sort({ _id: 1 }).lean(),
      ]);
      const [latest, revisions] = await Promise.all([
        this.orders.findOne(scope).select({ fulfillmentRevision: 1, continuationRevision: 1, pendingDailyReport: 1, closedAt: 1 }).lean(),
        this.financialAdjustments.find(adjustmentScope).select({ _id: 1, revision: 1 }).sort({ _id: 1 }).lean(),
      ]);
      if (!latest) throw new NotFoundException('该已派发按次订单不存在');
      if (order.fulfillmentRevision !== latest.fulfillmentRevision || order.continuationRevision !== latest.continuationRevision ||
        order.closedAt?.getTime() !== latest.closedAt?.getTime() || latest.pendingDailyReport ||
        adjustments.length !== revisions.length ||
        adjustments.some((item, idx) => !item._id.equals(revisions[idx]._id) || item.revision !== revisions[idx].revision)) continue;
      const calculation = calculateGiftSettlement(order, facts, reports, adjustments);
      const finalCalculation = persist && calculation.status === 'ready_to_close' ? await this.save(order, calculation) : null;
      return { calculation, finalCalculation };
    }
    throw new ConflictException('订单实绩或款项正在更新，请刷新后重新核对');
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
