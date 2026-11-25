import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClubDashboard, DashboardMetric, DashboardOrderList, DashboardOrderRow, DashboardSourceTotals } from '@sky-club/common';
import { isObjectIdOrHexString, Model, Types, type QueryFilter } from 'mongoose';
import type { SessionUser } from '../../auth/app-access';
import { ClubDailyReportStore } from './club-daily-report.store';
import { type DashboardProjection, dashboardNumber, dashboardOrder, isDashboardGiftOrder, matchesDashboardMetric } from './club-dashboard';
import { DailyReport } from './club-delivery.schema';
import { ClubDirectoryService } from './club-directory.service';
import { ClubFinancialAdjustment } from './club-financial-adjustment.schema';
import { ClubFinancialAdjustmentService } from './club-financial-adjustment.service';
import { giftFactsForOrders } from './club-gift-delivery';
import { giftSettlementOrders } from './club-gift-settlement.service';
import { calculateGiftSettlement } from './club-gift-settlement';
import type { ClubOrderQuery } from './club-order.dto';
import { ClubOrder } from './club-order.schema';
import { effectiveSettlementCash } from './club-settlement-cash';
import { CLUB_ID } from './club.schema';

const batchSize = 40;
const previewSize = 6;
const readyScope: QueryFilter<ClubOrder> = { $or: giftSettlementOrders, closedAt: null };

function isReadyCandidate(order: ClubOrder) {
  if (order.closedAt) return false;
  return order.dispatchStatus === 'published' && order.dispatchPricing?.priceUnit === 'gift_times' ||
    (order.dispatchStatus === 'draft' || order.dispatchStatus === 'pending') &&
    order.receipt?.quote.priceUnit === 'gift_times' && !!order.giftTermination?.id;
}

function groupByOrder<T extends { orderId?: Types.ObjectId }>(documents: readonly T[]) {
  const grouped = new Map<string, T[]>();
  for (const document of documents) {
    const id = document.orderId?.toHexString();
    if (!id) continue;
    const items = grouped.get(id) ?? [];
    items.push(document);
    grouped.set(id, items);
  }
  return grouped;
}

function emptySource(source: DashboardSourceTotals['source']): DashboardSourceTotals {
  return { source, orders: 0, deliveredGiftTimes: 0, knownReceivedHearts: 0, knownReceivedLines: 0, unknownReceivedLines: 0 };
}

@Injectable()
export class ClubDashboardService {
  constructor(
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    @InjectModel(DailyReport.name) private readonly reports: Model<DailyReport>,
    @InjectModel(ClubFinancialAdjustment.name) private readonly adjustments: Model<ClubFinancialAdjustment>,
    private readonly directory: ClubDirectoryService,
    private readonly financial: ClubFinancialAdjustmentService,
    private readonly dailyReports: ClubDailyReportStore,
  ) {}

  async dashboard(actor: SessionUser): Promise<ClubDashboard> {
    const { operations, finance } = await this.access(actor);
    if (!operations && !finance) return {};
    if (!finance) return this.readDashboard(actor, operations, finance);

    // Closing posts the ledger and removes the order from the ready queue in
    // one write. Retry the summary if that marker changed during these reads.
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await this.closedOrderCount();
      const data = await this.readDashboard(actor, operations, finance);
      if (before === await this.closedOrderCount()) return data;
    }
    throw new ConflictException('订单正在结单，请刷新仪表盘后重试');
  }

  private closedOrderCount() {
    return this.orders.countDocuments({ clubId: CLUB_ID, closedAt: { $type: 'date' } }).readConcern('majority');
  }

  private async readDashboard(actor: SessionUser, operations: boolean, finance: boolean): Promise<ClubDashboard> {
    const bySource = { direct_dispatch: emptySource('direct_dispatch'), client_order: emptySource('client_order') };
    let pendingOrders = 0;
    let claimableGiftTimes = 0n;
    let actionOrders = 0;
    const actionPreview: DashboardOrderRow[] = [];
    const dispatchPreview: DashboardOrderRow[] = [];
    let readyOrders = 0;
    let readyNetCents = 0n;
    const ready: NonNullable<ClubDashboard['finance']>['ready'] = [];

    for await (const { row, readyNetCents: net } of this.projectedOrders(operations ? {} : readyScope, finance)) {
      if (operations) {
        const source = bySource[row.source];
        source.orders++;
        source.deliveredGiftTimes = dashboardNumber(source.deliveredGiftTimes + (row.deliveredGiftTimes ?? 0));
        source.knownReceivedHearts = dashboardNumber(source.knownReceivedHearts + row.knownReceivedHearts);
        source.knownReceivedLines += row.knownReceivedLines;
        source.unknownReceivedLines += row.unknownReceivedLines;
        if (row.pendingDispatch) pendingOrders++;
        claimableGiftTimes += BigInt(row.claimableGiftTimes);
        if (row.actionLabel) {
          actionOrders++;
          if (actionPreview.length < previewSize) actionPreview.push(row);
        } else if ((row.pendingDispatch || row.dispatchStatus === 'pending_assignment') && dispatchPreview.length < previewSize) {
          dispatchPreview.push(row);
        }
      }
      if (finance && net !== null) {
        readyOrders++;
        readyNetCents += BigInt(net);
        if (ready.length < previewSize) ready.push({ orderId: row.orderId, netReceivedCents: net });
      }
    }

    const sources = Object.values(bySource);
    const result: ClubDashboard = {};
    if (operations) result.operations = {
      pendingOrders, claimableGiftTimes: dashboardNumber(claimableGiftTimes), actionOrders, sources,
      deliveredGiftTimes: dashboardNumber(sources.reduce((sum, source) => sum + source.deliveredGiftTimes, 0)),
      knownReceivedHearts: dashboardNumber(sources.reduce((sum, source) => sum + source.knownReceivedHearts, 0)),
      knownReceivedLines: sources.reduce((sum, source) => sum + source.knownReceivedLines, 0),
      unknownReceivedLines: sources.reduce((sum, source) => sum + source.unknownReceivedLines, 0),
      attention: [...actionPreview, ...dispatchPreview].slice(0, previewSize),
    };
    if (finance) result.finance = {
      readyOrders, readyNetCents: dashboardNumber(readyNetCents), ready,
      clubBalanceCents: (await this.financial.financeBalance(actor)).balanceCents,
    };
    return result;
  }

  async list(actor: SessionUser, { metric = 'all', source, after, limit = 25 }: ClubOrderQuery & { metric?: DashboardMetric }): Promise<DashboardOrderList> {
    const { operations, finance } = await this.access(actor);
    const needSettlement = metric === 'ready_to_close';
    if (needSettlement ? !finance : !operations) throw new ForbiddenException('当前账号没有查阅该仪表盘明细的权限');

    const scope = { ...this.filterScope(metric), ...(source ? { source } : {}) };
    const items: DashboardOrderRow[] = [];
    for await (const projection of this.projectedOrders(scope, needSettlement, after)) {
      if (!matchesDashboardMetric(projection, metric)) continue;
      if (items.length === limit) return { items, nextCursor: items[limit - 1].orderId };
      items.push(projection.row);
    }
    return { items, nextCursor: null };
  }

  async detail(actor: SessionUser, id: string): Promise<DashboardOrderRow> {
    if (!(await this.access(actor)).operations) throw new ForbiddenException('当前账号没有查阅仪表盘订单的权限');
    if (!isObjectIdOrHexString(id)) throw new BadRequestException('订单标识格式无效');
    const order = await this.orders.findOne({ _id: new Types.ObjectId(id), clubId: CLUB_ID }).readConcern('majority').lean();
    if (!order) throw new NotFoundException('本单不存在');
    const [projection] = await this.projectBatch([order], false);
    if (!projection) throw new NotFoundException('本单不存在');
    return projection.row;
  }

  private async access(actor: SessionUser) {
    const { permissions } = await this.directory.getAdminClub(actor);
    return { operations: permissions.includes('CLUB_ORDERS_READ'), finance: permissions.includes('CLUB_FINANCE_READ') };
  }

  private filterScope(metric: DashboardMetric): QueryFilter<ClubOrder> {
    if (metric === 'ready_to_close') return readyScope;
    if (metric === 'pending_dispatch') return { dispatchStatus: { $in: ['draft', 'pending'] }, dispatcherUserId: { $type: 'string' } };
    if (metric === 'claimable') return { dispatchStatus: 'published', 'giftDispatch.segments.0': { $exists: true } };
    return {};
  }

  private async *projectedOrders(scope: QueryFilter<ClubOrder>, calculateReady: boolean, after?: string) {
    let next = after ? new Types.ObjectId(after) : undefined;
    for (;;) {
      const orders = await this.orders.find({ clubId: CLUB_ID, ...scope, ...(next ? { _id: { $lt: next } } : {}) })
        .sort({ _id: -1 }).limit(batchSize).readConcern('majority').lean();
      if (!orders.length) return;
      yield* await this.projectBatch(orders, calculateReady);
      if (orders.length < batchSize) return;
      next = orders[orders.length - 1]._id;
    }
  }

  private async projectBatch(initial: ClubOrder[], calculateReady: boolean): Promise<DashboardProjection[]> {
    const scope = { clubId: CLUB_ID, _id: { $in: initial.map(order => order._id) } };
    let orders = initial;
    for (let attempt = 0; attempt < 5; attempt++) {
      // Finish only commands already admitted by the normal writers before reading their facts.
      for (const order of orders) {
        if (order.pendingFinancialAdjustment) await this.financial.flushOrderAdjustment(order);
        if (order.pendingDailyReport) await this.dailyReports.flushPendingReport(order);
      }
      if (orders.some(order => order.pendingFinancialAdjustment || order.pendingDailyReport)) {
        orders = await this.orders.find(scope).sort({ _id: -1 }).readConcern('majority').lean();
        continue;
      }

      const result = await this.readBatch(orders, calculateReady);
      const revisions = await this.orders.find(scope).select({
        fulfillmentRevision: 1, continuationRevision: 1, financialRevision: 1, settlementCorrectionRevision: 1,
        updatedAt: 1, closedAt: 1, pendingDailyReport: 1, pendingFinancialAdjustment: 1,
      }).sort({ _id: -1 }).readConcern('majority').lean();
      if (orders.length === revisions.length && orders.every((order, idx) => {
        const revision = revisions[idx];
        return order._id.equals(revision._id) && !revision.pendingDailyReport && !revision.pendingFinancialAdjustment &&
          order.fulfillmentRevision === revision.fulfillmentRevision && order.continuationRevision === revision.continuationRevision &&
          order.financialRevision === revision.financialRevision && order.settlementCorrectionRevision === revision.settlementCorrectionRevision &&
          order.closedAt?.getTime() === revision.closedAt?.getTime() && order.updatedAt?.getTime() === revision.updatedAt?.getTime();
      })) return result;
      orders = await this.orders.find(scope).sort({ _id: -1 }).readConcern('majority').lean();
    }
    throw new ConflictException('仪表盘正在同步最新订单，请刷新后重试');
  }

  private async readBatch(orders: ClubOrder[], calculateReady: boolean) {
    const giftOrders = orders.filter(isDashboardGiftOrder);
    const candidates = calculateReady ? giftOrders.filter(isReadyCandidate) : [];
    const reportsScope: QueryFilter<DailyReport>[] = [];
    const legacyIds = orders.filter(order => !isDashboardGiftOrder(order) && order.shares?.length).map(order => order._id);
    if (legacyIds.length) reportsScope.push({ orderId: { $in: legacyIds }, kind: 'daily', priceUnit: null });
    const candidateShares = candidates.flatMap(order => this.giftShareIds(order).map(id => new Types.ObjectId(id)));
    if (candidates.length) reportsScope.push({ orderId: { $in: candidates.map(order => order._id) }, $or: [
      { priceUnit: 'gift_times' }, { priceUnit: null, $or: [{ shareId: { $in: candidateShares } }, { 'lines.shareId': { $in: candidateShares } }] },
    ] });

    const [facts, reports, adjustments] = await Promise.all([
      giftFactsForOrders(this.reports.collection, giftOrders),
      reportsScope.length ? this.reports.find({ $or: reportsScope }).sort({ _id: 1 }).readConcern('majority').lean() : [],
      giftOrders.length ? this.adjustments.find({
        clubId: CLUB_ID, orderId: { $in: giftOrders.map(order => order._id) },
        ...(calculateReady ? {} : { kind: 'customer_compensation', status: 'approved' }),
      }).sort({ _id: 1 }).readConcern('majority').lean() : [],
    ]);
    const factsByOrder = groupByOrder(facts.map(fact => ({ orderId: fact._id.orderId, fact })));
    const reportsByOrder = groupByOrder(reports);
    const adjustmentsByOrder = groupByOrder(adjustments);

    return orders.map((order): DashboardProjection => {
      const id = order._id.toHexString();
      const shareIds = new Set(this.giftShareIds(order));
      const orderFacts = (factsByOrder.get(id) ?? []).flatMap(({ fact }) => shareIds.has(fact._id.shareId.toHexString()) ? [fact] : []);
      const orderReports = reportsByOrder.get(id) ?? [];
      const orderAdjustments = adjustmentsByOrder.get(id) ?? [];
      const readyCandidate = calculateReady && isReadyCandidate(order);
      const needsCash = !!order.giftTermination || order.giftPriceAdjustmentState === 'stopped' ||
        orderAdjustments.some(item => item.kind === 'customer_compensation' && item.status === 'approved');
      const giftReports = readyCandidate ? orderReports.filter(report => report.priceUnit === 'gift_times' ||
        shareIds.has(report.shareId.toHexString()) || report.lines.some(line => line.shareId && shareIds.has(line.shareId.toHexString())),
      ) : [];
      const calculation = readyCandidate || needsCash ? effectiveSettlementCash(order,
        calculateGiftSettlement(order, orderFacts, giftReports, orderAdjustments)) : null;
      return {
        row: dashboardOrder(order, orderFacts, orderReports, calculation?.cash?.refundRemainingCents ?? null),
        readyNetCents: readyCandidate && calculation?.status === 'ready_to_close' ? calculation.cash?.netReceivedCents ?? null : null,
      };
    });
  }

  private giftShareIds(order: ClubOrder) {
    return order.giftDispatch?.segments.flatMap(segment => segment.shares.map(share => share.id)) ?? [];
  }
}
