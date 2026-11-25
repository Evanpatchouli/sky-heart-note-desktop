import {
  BadRequestException, ConflictException, Injectable, Logger,
  NotFoundException, OnModuleDestroy, OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { USER_ID_PATTERN } from '@sky-club/common';
import { isObjectIdOrHexString, Model, Types } from 'mongoose';
import { parseApp, type WebApp } from '../../auth/app-access';
import { AppNotificationEvent, noticeTypes, type NoticeTarget, type NoticeType } from './app-notification.schema';
import { ClubDirectoryService } from './club-directory.service';
import { ClubDispatchNotice } from './club-dispatch-notice.schema';
import { ClubFinancialAdjustment } from './club-financial-adjustment.schema';
import { hasConfirmedMemberPenalty } from './club-gift-settlement-adjustments';
import { ClubOrder } from './club-order.schema';
import { CLUB_ID } from './club.schema';

const durable = { writeConcern: { w: 'majority', j: true } } as const;
const batchSize = 50;

export interface PublishAppNotification {
  eventKey: string;
  targetApp: WebApp;
  type: NoticeType;
  recipientUserIds: readonly string[];
  title: string;
  body?: string;
  occurredAt?: Date;
  clubId?: string;
  target?: NoticeTarget;
  objectId?: string;
}

function isDuplicateKey(error: unknown) {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 11000;
}

@Injectable()
export class AppNotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppNotificationService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private penaltyCursor?: Types.ObjectId;

  constructor(
    @InjectModel(AppNotificationEvent.name) private readonly events: Model<AppNotificationEvent>,
    @InjectModel(ClubDispatchNotice.name) private readonly notices: Model<ClubDispatchNotice>,
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    @InjectModel(ClubFinancialAdjustment.name) private readonly adjustments: Model<ClubFinancialAdjustment>,
    private readonly directory: ClubDirectoryService,
  ) {}

  async onModuleInit() {
    await this.events.init();
  }

  startDelivery() {
    if (this.timer) return;
    const poll = () => {
      this.running ??= this.deliverReady()
        .catch(() => this.logger.warn('通知投递未完成，后台将重试'))
        .finally(() => { this.running = undefined; });
    };
    this.timer = setInterval(poll, 1000).unref();
    poll();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
  }

  async publish(input: PublishAppNotification) {
    const targetApp = parseApp(input.targetApp);
    const { eventKey, type, objectId, clubId } = input;
    const title = input.title?.trim();
    const body = input.body?.trim() || undefined;
    const target = input.target ?? 'inbox';
    const recipientUserIds = [...new Set(input.recipientUserIds)].sort();
    if (!eventKey || eventKey.length > 160 || !noticeTypes.includes(type) ||
        !title || title.length > 100 || (body && body.length > 300) ||
        !recipientUserIds.length || recipientUserIds.some(id => !USER_ID_PATTERN.test(id)) ||
        input.occurredAt && !Number.isFinite(input.occurredAt.getTime()) ||
        (clubId && (clubId !== CLUB_ID || targetApp !== 'employee')) ||
        (target === 'inbox' && objectId !== undefined) ||
        target !== 'inbox' && (target !== 'client-order-assigned' || targetApp !== 'employee' ||
          clubId !== CLUB_ID || !isObjectIdOrHexString(objectId))) {
      throw new BadRequestException('通知事件参数无效');
    }
    const occurredAt = input.occurredAt ?? new Date();
    const key = { eventKey, targetApp };
    const values = { type, recipientUserIds, title, body, target, objectId, clubId };
    const receipt = await this.events.findOneAndUpdate(key, {
      $setOnInsert: { ...values, occurredAt, nextAttemptAt: new Date() },
    }, { upsert: true, returnDocument: 'after', ...durable }).lean().catch(error => {
      if (!isDuplicateKey(error)) throw error;
      return this.events.findOne(key).readConcern('majority').lean().exec();
    });
    if (!receipt) throw new Error('无法核对通知事件');
    if (receipt.type !== type || receipt.title !== title || receipt.body !== body ||
        receipt.target !== target || receipt.objectId !== objectId || receipt.clubId !== clubId ||
        JSON.stringify(receipt.recipientUserIds) !== JSON.stringify(recipientUserIds)) {
      throw new ConflictException('相同通知事件已保存，内容不同');
    }
    return { id: receipt._id.toHexString(), eventKey, targetApp, type, recipientUserIds };
  }

  async list(app: WebApp, userId: string, after: string | undefined, limit: number) {
    const scope = await this.inboxScope(app, userId);
    const [items, unread] = await Promise.all([
      this.notices.find({ ...scope, ...(after ? { _id: { $lt: new Types.ObjectId(after) } } : {}) })
        .sort({ _id: -1 }).limit(limit + 1).lean(),
      this.notices.exists({ ...scope, readAt: null }),
    ]);
    return {
      items: items.slice(0, limit).map(notice => this.describe(notice)),
      hasUnread: Boolean(unread),
      nextCursor: items.length > limit ? items[limit - 1]._id.toHexString() : null,
    };
  }

  async detail(app: WebApp, userId: string, id: string) {
    const scope = await this.inboxScope(app, userId);
    const notice = await this.notices.findOne({ ...scope, _id: id }).lean();
    if (!notice) throw new NotFoundException('通知不存在');
    if (notice.target === 'client-order-assigned' && !await this.orders.exists({
      _id: notice.orderId, clubId: notice.clubId, source: 'client_order', dispatcherUserId: userId,
    })) throw new NotFoundException('订单不存在或已无法查看');
    return this.describe(notice);
  }

  async markRead(app: WebApp, userId: string, id: string) {
    const { $or, ...scope } = await this.inboxScope(app, userId);
    const notice = await this.notices.findOneAndUpdate({
      ...scope, _id: id, type: { $in: ['normal', 'important'] },
    }, [{ $set: { readAt: { $ifNull: ['$readAt', '$$NOW'] } } }], {
      projection: { readAt: 1 }, returnDocument: 'after', updatePipeline: true,
    }).lean();
    if (!notice) throw new NotFoundException('通知不存在');
    return { id, readAt: notice.readAt };
  }

  private async inboxScope(targetApp: WebApp, recipientUserId: string) {
    const club = targetApp === 'employee' ? await this.directory.getEmployeeClub(recipientUserId) : null;
    return {
      targetApp, recipientUserId, clubId: { $in: club ? [null, CLUB_ID] : [null] },
      $or: [{ type: 'important' }, { type: 'normal', readAt: null }],
    };
  }

  private describe(notice: ClubDispatchNotice) {
    const id = notice._id.toHexString();
    const orderId = notice.orderId?.toHexString();
    const legacyDispatch = !notice.eventKey;
    const href = legacyDispatch ? `/claim-board?noticeId=${id}`
      : notice.target === 'client-order-assigned' ? `/club/dispatch?notificationId=${id}` : null;
    return {
      id, orderId, href, eventKey: notice.eventKey, targetApp: notice.targetApp,
      target: legacyDispatch ? 'claim-board' : notice.target,
      title: notice.title ?? '新派单', body: notice.body, type: notice.type,
      publishedAt: notice.publishedAt, readAt: notice.readAt,
    };
  }

  private async deliverReady() {
    const results = await Promise.allSettled([this.collectAssignments(), this.collectPenalties(), this.writeInboxes()]);
    for (const result of results) {
      if (result.status === 'rejected') this.logger.warn('一批通知尚未保存，后台将重试');
    }
  }

  private async collectAssignments() {
    const orders = await this.orders.find({ source: 'client_order', intakeNoticePendingAt: { $type: 'date' } })
      .readConcern('majority').select({ intakeNoticePendingAt: 1, clubId: 1, dispatcherUserId: 1 })
      .sort({ intakeNoticePendingAt: 1, _id: 1 }).limit(batchSize).lean();
    for (const order of orders) {
      if (!order.dispatcherUserId || !order.intakeNoticePendingAt) continue;
      await this.publish({
        eventKey: `club.order.assigned:${order._id}`, type: 'important', targetApp: 'employee', clubId: order.clubId,
        recipientUserIds: [order.dispatcherUserId], occurredAt: order.intakeNoticePendingAt,
        title: '有新的客户端订单', body: '请前往派单准备处理本单。',
        target: 'client-order-assigned', objectId: order._id.toHexString(),
      });
      await this.orders.updateOne({ _id: order._id, intakeNoticePendingAt: order.intakeNoticePendingAt },
        { $unset: { intakeNoticePendingAt: '' } }, { timestamps: false, ...durable });
    }
  }

  private async collectPenalties() {
    const adjustments = await this.adjustments.find({
      clubId: CLUB_ID, kind: 'member_penalty', status: 'approved', notificationPublishedAt: null,
      ...(this.penaltyCursor ? { _id: { $gt: this.penaltyCursor } } : {}),
    }).readConcern('majority')
      .select({ clubId: 1, kind: 1, status: 1, amountCents: 1, decidedByUserId: 1,
        decidedAt: 1, memberUserId: 1, requestedByUserId: 1, refunds: 1 })
      .sort({ _id: 1 }).limit(batchSize).lean();
    // Revisit old candidates on the next sweep so corrected data can publish,
    // while an entire page of incomplete records cannot hold up newer ones.
    this.penaltyCursor = adjustments.length === batchSize ? adjustments.at(-1)?._id : undefined;
    for (const adjustment of adjustments) {
      try {
        await this.recordApprovedPenalty(adjustment);
      } catch {
        this.logger.warn('罚款通知尚未保存，后台将重试');
      }
    }
  }

  // The approval record is the durable source. Live writers may call this once
  // their update is committed; the reconciler also processes unconsumed approvals.
  async publishApprovedPenalty(penaltyId: string) {
    if (!isObjectIdOrHexString(penaltyId)) throw new BadRequestException('罚款标识格式无效');
    const penalty = await this.adjustments.findOne({
      _id: penaltyId, clubId: CLUB_ID, kind: 'member_penalty', status: 'approved',
    }).readConcern('majority').lean();
    if (!penalty) return null;
    return this.recordApprovedPenalty(penalty);
  }

  private async recordApprovedPenalty(adjustment: ClubFinancialAdjustment) {
    if (adjustment.clubId !== CLUB_ID || !(adjustment.decidedAt instanceof Date) || !hasConfirmedMemberPenalty(adjustment)) {
      return null;
    }
    const { _id, clubId, memberUserId, requestedByUserId, decidedAt } = adjustment;
    const receipt = await this.publish({
      eventKey: `club.penalty.approved:${_id}`,
      targetApp: 'employee', type: 'important', clubId, occurredAt: decidedAt,
      recipientUserIds: [memberUserId, requestedByUserId],
      title: '罚款已生效', body: '一笔与你有关的团员罚款已生效。',
    });
    await this.adjustments.updateOne({ _id, status: 'approved', notificationPublishedAt: null },
      { $set: { notificationPublishedAt: new Date() } }, durable);
    return receipt;
  }

  private async writeInboxes() {
    const events = await this.events.find({ nextAttemptAt: { $lte: new Date() } })
      .readConcern('majority').sort({ nextAttemptAt: 1, _id: 1 }).limit(batchSize).lean();
    for (const event of events) {
      try {
        const orderId = event.objectId ? new Types.ObjectId(event.objectId) : undefined;
        for (let offset = 0; offset < event.recipientUserIds.length; offset += 200) {
          await this.notices.bulkWrite(event.recipientUserIds.slice(offset, offset + 200).map(recipientUserId => ({
            updateOne: {
              filter: { publicationId: event._id, recipientUserId },
              update: { $setOnInsert: {
                clubId: event.clubId, orderId, eventKey: event.eventKey, targetApp: event.targetApp,
                type: event.type, target: event.target, title: event.title, body: event.body,
                publishedAt: event.occurredAt, readAt: null,
              } },
              upsert: true,
            },
          })), { ordered: false, ...durable });
        }
        await this.events.updateOne({ _id: event._id, nextAttemptAt: { $exists: true } }, {
          $unset: { nextAttemptAt: '' },
          ...(event.type === 'normal' ? {} : { $set: { pushNextAttemptAt: new Date() } }),
        }, durable);
      } catch {
        await this.events.updateOne({ _id: event._id, nextAttemptAt: event.nextAttemptAt },
          { $set: { nextAttemptAt: new Date(Date.now() + 5000) } }, durable);
      }
    }
  }
}
