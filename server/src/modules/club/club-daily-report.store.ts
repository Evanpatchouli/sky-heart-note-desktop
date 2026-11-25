import { BadRequestException, ConflictException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isObjectIdOrHexString, Model, QueryFilter, Types } from 'mongoose';
import { isDuplicateKey } from '../user-module/user-id';
import { dailyReportView } from './club-daily-report-view';
import { DailyReport } from './club-delivery.schema';
import { giftDayFacts } from './club-gift-delivery';
import { couponCanBeReturned } from './club-gift-termination';
import { ClubOrder } from './club-order.schema';

const durable = { writeConcern: { w: 'majority', j: true } } as const;

export function reportObjectId(value: string) {
  if (!isObjectIdOrHexString(value))
    throw new BadRequestException('订单、份额或日报标识格式无效');
  return new Types.ObjectId(value);
}

@Injectable()
export class ClubDailyReportStore implements OnModuleInit {
  private readonly logger = new Logger(ClubDailyReportStore.name);

  constructor(
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    @InjectModel(DailyReport.name) private readonly reports: Model<DailyReport>,
  ) {}

  async onModuleInit() {
    await this.reports.init();
    const pending = this.orders.find({ 'pendingDailyReport._id': { $exists: true } })
      .select({ pendingDailyReport: 1 }).lean().cursor();
    for await (const order of pending) {
      try {
        await this.flushPendingReport(order);
      } catch {
        this.logger.warn(`订单 ${order._id.toHexString()} 有日报待补写，将在访问该单时重试`);
      }
    }
  }

  async history(
    order: ClubOrder,
    userId: string,
    after?: string,
  ) {
    await this.flushPendingReport(order);
    const pageSize = 25;
    const page = await this.reports
      .find({
        orderId: order._id,
        userId,
        ...(after ? { _id: { $lt: reportObjectId(after) } } : {}),
      })
      .sort({ _id: -1 })
      .limit(pageSize + 1)
      .lean();
    const current = page.slice(0, pageSize);
    const keys = current.flatMap((item) =>
      item.version > 1
        ? [{ originalId: item.originalId, version: item.version - 1 }]
        : [],
    );
    const roots = current.map((report) => report.originalId);
    const [preceding, latestVersions] = await Promise.all([
      keys.length
        ? this.reports.find({ orderId: order._id, userId, $or: keys }).lean()
        : [],
      current.length
        ? this.reports
            .aggregate<{
              _id: Types.ObjectId;
              version: number;
            }>([
              { $match: { orderId: order._id, userId, originalId: { $in: roots } } },
              { $group: { _id: '$originalId', version: { $max: '$version' } } },
            ])
            .exec()
        : [],
    ]);
    const versions = new Map(
      [...current, ...preceding].map((report) => [
        `${report.originalId}:${report.version}`,
        report,
      ]),
    );
    const latest = new Map<string, number>(
      latestVersions.map(
        (item) => [item._id.toHexString(), item.version] as const,
      ),
    );
    const giftShares = new Set(order.giftDispatch?.segments.flatMap(segment => segment.shares.map(share => share.id)));
    return {
      items: current.map((report) => ({
        ...dailyReportView(
          report,
          versions.get(`${report.originalId}:${report.version - 1}`),
          report.priceUnit === 'gift_times' || giftShares.has(report.shareId.toHexString()),
        ),
        latestVersion: latest.get(report.originalId.toHexString()),
      })),
      nextCursor:
        page.length > pageSize ? current.at(-1)!._id.toHexString() : null,
    };
  }

  async stage(order: ClubOrder, scope: QueryFilter<ClubOrder>, report: DailyReport,
    priceAdjustment?: Pick<ClubOrder, 'giftPriceAdjustments' | 'giftPriceAdjustmentState'>) {
    const { modifiedCount } = await this.orders.updateOne({
      ...scope,
      _id: order._id,
      fulfillmentRevision: order.fulfillmentRevision ?? { $in: [null, 0] },
      pendingDailyReport: null,
    }, { $set: { pendingDailyReport: report, ...priceAdjustment }, $inc: { fulfillmentRevision: 1 } }, durable);
    if (!modifiedCount) return false;
    await this.flushPendingReport({ _id: order._id, pendingDailyReport: report });
    return true;
  }

  // Serialize report admissions against repricing on the order document. The staged
  // fact can be copied again after a timeout or restart, using the same Mongo ID.
  async flushPendingReport({ _id, pendingDailyReport }: Pick<ClubOrder, '_id' | 'pendingDailyReport'>) {
    if (!pendingDailyReport) return;
    try {
      await this.reports.collection.insertOne(pendingDailyReport, durable);
    } catch (error) {
      if (
        !['_id', 'requestId', 'businessDate', 'originalId'].some((field) =>
          isDuplicateKey(error, field),
        )
      )
        throw error;
    }
    const scope = { _id, 'pendingDailyReport._id': pendingDailyReport._id };
    const stopped = pendingDailyReport.priceUnit === 'gift_times' && await this.orders.findOne({
      ...scope, activePromotionCouponId: { $type: 'string' },
      $or: [{ giftTermination: { $exists: true } }, { giftPriceAdjustmentState: 'stopped' }],
    }).lean();
    const refundedCoupon = stopped && couponCanBeReturned(stopped, await giftDayFacts(this.reports.collection, stopped));
    await this.orders.updateOne(scope, {
      $unset: { pendingDailyReport: 1, ...(refundedCoupon ? { activePromotionCouponId: 1 } : {}) },
      ...(refundedCoupon ? { $set: { promotionCouponReturnedAt: new Date().toISOString() } } : {}),
    }, durable);
  }

  async replay(
    scope: { orderId: Types.ObjectId; userId: string; requestId: string },
    hash: string,
    isGiftReport?: boolean,
  ) {
    const report = await this.reports.findOne(scope).lean();
    if (!report) return null;
    if (report.requestHash !== hash)
      throw new ConflictException('相同提交标识已用于内容不同的日报请求');
    const previous =
      report.version === 1
        ? null
        : await this.reports
            .findOne({
              orderId: scope.orderId,
              userId: scope.userId,
              originalId: report.originalId,
              version: report.version - 1,
            })
            .lean();
    return dailyReportView(report, previous ?? undefined, isGiftReport);
  }
}
