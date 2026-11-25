import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type {
  AdminSettlement,
  AdminGiftSettlement,
  GiftSettlementCalculation,
  GiftSettlementRow,
  PersonalGiftSettlement,
  PersonalSettlement,
  SettlementCalculation,
  SettlementOrderRow,
} from '@webapp-template/common';
import { isObjectIdOrHexString, Model, Types, type QueryFilter } from 'mongoose';
import type { SessionUser } from '../../auth/app-access';
import { DailyReport } from './club-delivery.schema';
import { ClubDeliveryService } from './club-delivery.service';
import { ClubDirectoryService } from './club-directory.service';
import { ClubGiftSettlementService, giftSettlementOrders } from './club-gift-settlement.service';
import type { ClubOrderQuery } from './club-order.dto';
import { activityQuantities } from './club-order-pricing';
import { ClubOrder } from './club-order.schema';
import {
  ACTIVITY_SETTLEMENT_CALCULATION_VERSION,
  ADJUSTED_SETTLEMENT_CALCULATION_VERSION,
  calculateSettlement,
  SETTLEMENT_CALCULATION_VERSION,
  TERMINATED_SETTLEMENT_CALCULATION_VERSION,
} from './club-settlement';
import { ClubSettlementCalculation } from './club-settlement.schema';
import { ClubSettlementEvidenceService, settlementReference } from './club-settlement-evidence.service';

function objectId(value: string) {
  if (!isObjectIdOrHexString(value))
    throw new BadRequestException('订单标识格式无效');
  return new Types.ObjectId(value);
}

type CalculationMetadata = Pick<
  ClubSettlementCalculation,
  '_id' | 'version' | 'calculatedAt'
>;
const settlementOrders: QueryFilter<ClubOrder> = {
  $or: [
    ...giftSettlementOrders,
    { dispatchStatus: 'published', 'heartDelivery.requestedHearts': { $exists: true } },
  ],
};

function isGiftOrder(order: ClubOrder) {
  return order.dispatchPricing?.priceUnit === 'gift_times' ||
    !!order.giftTermination && order.receipt?.quote.priceUnit === 'gift_times';
}

@Injectable()
export class ClubSettlementService {
  constructor(
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    @InjectModel(DailyReport.name) private readonly reports: Model<DailyReport>,
    @InjectModel(ClubSettlementCalculation.name)
    private readonly calculations: Model<ClubSettlementCalculation>,
    private readonly directory: ClubDirectoryService,
    private readonly delivery: ClubDeliveryService,
    private readonly gift: ClubGiftSettlementService,
    private readonly evidence: ClubSettlementEvidenceService,
  ) {}

  async adminList(clubId: string, actor: SessionUser, query: ClubOrderQuery) {
    await this.directory.requireAdminPermission(
      clubId,
      actor,
      'CLUB_FINANCE_READ',
    );
    const limit = query.limit ?? 25;
    const orders = await this.orders
      .find({
        clubId,
        ...settlementOrders,
        ...(query.source ? { source: query.source } : {}),
        ...(query.after ? { _id: { $lt: objectId(query.after) } } : {}),
      })
      .select({ source: 1, publishedAt: 1, 'heartDelivery.requestedHearts': 1, 'dispatchPricing.segments': 1,
        'dispatchPricing.priceUnit': 1, 'receipt.quote.priceUnit': 1, 'giftTermination.id': 1 })
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();
    const visible = orders.slice(0, limit);
    const legacy = visible.filter(order => !isGiftOrder(order));
    const existing = legacy.length
      ? await this.calculations.aggregate<
          CalculationMetadata & { orderId: Types.ObjectId }
        >([
          {
            $match: {
              clubId,
              orderId: { $in: legacy.map((order) => order._id) },
            },
          },
          { $sort: { orderId: 1, calculatedAt: -1, _id: -1 } },
          {
            $group: {
              _id: '$orderId',
              entry: {
                $first: {
                  _id: '$_id',
                  orderId: '$orderId',
                  version: '$version',
                  calculatedAt: '$calculatedAt',
                },
              },
            },
          },
          { $replaceWith: '$entry' },
        ])
      : [];
    const byOrder = new Map(
      existing.map((item) => [item.orderId.toHexString(), item]),
    );
    const items = await Promise.all(visible.map(async (order): Promise<SettlementOrderRow | GiftSettlementRow> =>
      isGiftOrder(order) ? this.gift.row(clubId, order._id) : ({
      orderId: order._id.toHexString(),
      source: order.source,
      requestedHearts: order.heartDelivery.requestedHearts ?? 0,
      ...activityQuantities(order),
      publishedAt: order.publishedAt?.toISOString() ?? null,
      finalCalculation: settlementReference(byOrder.get(order._id.toHexString())),
    })));
    return {
      items,
      nextCursor: orders.length > limit ? items[limit - 1].orderId : null,
    };
  }

  async adminDetail(
    clubId: string,
    actor: SessionUser,
    orderId: string,
  ): Promise<AdminSettlement | AdminGiftSettlement> {
    await this.directory.requireAdminPermission(
      clubId,
      actor,
      'CLUB_FINANCE_READ',
    );
    const order = await this.orders
      .findOne({
        _id: objectId(orderId),
        clubId,
        ...settlementOrders,
      })
      .lean();
    if (!order) throw new NotFoundException('该已派发订单不存在');
    if (isGiftOrder(order)) return this.gift.adminDetail(clubId, actor, orderId);
    const { calculation, finalCalculation } = await this.current(order);
    const previousCalculation = await this.evidence.latest(clubId, order._id, finalCalculation?.id);
    const memberNames = await this.memberNames(calculation);
    return {
      ...calculation,
      finalCalculation,
      previousCalculation,
      memberNames,
    };
  }

  async historical(
    clubId: string,
    actor: SessionUser,
    orderId: string,
    id: string,
  ) {
    await this.directory.requireAdminPermission(
      clubId,
      actor,
      'CLUB_FINANCE_READ',
    );
    const { calculation, finalCalculation } = await this.evidence.read<SettlementCalculation | GiftSettlementCalculation>(clubId, objectId(orderId), id);
    const memberNames = await this.memberNames(calculation);
    return {
      ...calculation,
      finalCalculation,
      previousCalculation: null,
      memberNames,
    };
  }

  async personal(
    clubId: string,
    userId: string,
    orderId: string,
  ): Promise<PersonalSettlement | PersonalGiftSettlement> {
    await this.directory.requireMember(clubId, userId);
    const order = await this.orders
      .findOne({
        _id: objectId(orderId),
        clubId,
        ...settlementOrders,
        $and: [{ $or: [{ dispatcherUserId: userId }, { 'shares.userId': userId }, { 'giftDispatch.segments.shares.userId': userId }] }],
      })
      .lean();
    if (!order) throw new NotFoundException('该已派发订单不存在');
    if (isGiftOrder(order)) return this.gift.personal(clubId, userId, orderId);
    const { calculation, finalCalculation } = await this.current(order);
    const own = calculation.members.find((member) => member.userId === userId);
    return {
      ...(calculation.termination ? { stopped: true as const } : {}),
      finalCalculation,
      member: own
        ? {
            claimedHearts: own.claimedHearts,
            rewardCents: own.rewardCents,
            knownSubtotalCents: own.knownSubtotalCents,
            plannedRewardCents: own.plannedRewardCents,
            totalCents: own.totalCents,
            issues: own.issues,
            segments: own.segments.map(
              ({ number, receivedHearts, giftTimes, rewardCents }) => ({
                number,
                receivedHearts,
                giftTimes,
                rewardCents,
              }),
            ),
          }
        : null,
      dispatch:
        calculation.dispatcherUserId === userId
          ? {
              feeCents: calculation.totals.dispatchFeeCents,
              plannedFeeCents: calculation.planned.dispatchFeeCents,
              ...(calculation.activity?.kind === 'discount' ? { discountCostPending: true } : {}),
            }
          : null,
    };
  }

  private async current(order: ClubOrder) {
    const reportScope = { orderId: order._id };
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await this.orders.findById(order._id).lean();
      if (!before) throw new NotFoundException('该已派发订单不存在');
      await this.delivery.flushPendingReport(before);
      const reports = await this.reports
        .find(reportScope)
        .sort({ _id: 1 })
        .lean();
      const latest = await this.orders.findById(order._id).lean();
      if (!latest) throw new NotFoundException('该已派发订单不存在');
      if (latest.fulfillmentRevision !== before.fulfillmentRevision || latest.pendingDailyReport)
        continue;
      const calculation = calculateSettlement(latest, reports);
      if (calculation.issues.length)
        return { calculation, finalCalculation: null };
      // Reports are append-only. Verify that the report set was unchanged when
      // the order and its fulfillment facts were read, even on standalone MongoDB.
      if ((await this.reports.countDocuments(reportScope)) !== reports.length)
        continue;
      const finalCalculation = await this.save(latest, calculation);
      return { calculation, finalCalculation };
    }
    throw new ConflictException('日报正在更新，请刷新后重新核对');
  }

  private async memberNames(calculation: {
    dispatcherUserId: string; members: { userId: string }[]; receipt: { receivedByUserId: string } | null;
  }) {
    const ids = [
      calculation.dispatcherUserId,
      ...calculation.members.map((member) => member.userId),
      ...(calculation.receipt ? [calculation.receipt.receivedByUserId] : []),
    ];
    return Object.fromEntries(
      await this.directory.memberNicknames([...new Set(ids)]),
    );
  }

  private async save(order: ClubOrder, calculation: SettlementCalculation) {
    const version = calculation.termination ? TERMINATED_SETTLEMENT_CALCULATION_VERSION
      : calculation.priceAdjustment ? ADJUSTED_SETTLEMENT_CALCULATION_VERSION
      : calculation.activity ? ACTIVITY_SETTLEMENT_CALCULATION_VERSION : SETTLEMENT_CALCULATION_VERSION;
    return this.evidence.save(order.clubId, order._id, version, calculation);
  }
}
