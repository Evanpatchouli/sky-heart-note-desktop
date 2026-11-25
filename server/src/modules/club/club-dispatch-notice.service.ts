import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isObjectIdOrHexString, Model, Types } from 'mongoose';
import { ClubDirectoryService } from './club-directory.service';
import {
  ClubDispatchNotice,
  type DispatchPublication,
} from './club-dispatch-notice.schema';
import { ClubOrder } from './club-order.schema';
import { CLUB_ID } from './club.schema';

const POLL_INTERVAL_MS = 1_000;
const RETRY_DELAY_MS = 5_000;
const ORDER_BATCH_SIZE = 20;
const RECIPIENT_BATCH_SIZE = 200;
const DURABLE_WRITE = { w: 'majority', j: true } as const;

@Injectable()
export class ClubDispatchNoticeService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ClubDispatchNoticeService.name);
  private timer?: NodeJS.Timeout;
  private delivery?: Promise<void>;

  constructor(
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    @InjectModel(ClubDispatchNotice.name)
    private readonly notices: Model<ClubDispatchNotice>,
    private readonly directory: ClubDirectoryService,
  ) {}

  async onModuleInit() {
    await this.notices.init();
  }

  startDelivery() {
    if (this.timer) return;
    const poll = () => {
      if (this.delivery) return;
      this.delivery = this.deliverReady()
        .catch(() => this.logger.error('暂时无法处理派单通知，后台将重试'))
        .finally(() => {
          this.delivery = undefined;
        });
    };
    this.timer = setInterval(poll, POLL_INTERVAL_MS).unref();
    poll();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.delivery;
  }

  async list(userId: string, query: { after?: string; limit?: number }) {
    const { clubName, scope } = await this.inboxScope(userId);
    const limit = query.limit ?? 25;
    const [notices, unread] = await Promise.all([
      this.notices
        .find({
          ...scope,
          ...(query.after
            ? { publicationId: { $lt: new Types.ObjectId(query.after) } }
            : {}),
        })
        .select({
          publicationId: 1,
          clubId: 1,
          orderId: 1,
          publishedAt: 1,
          readAt: 1,
        })
        .sort({ publicationId: -1 })
        .limit(limit + 1)
        .lean(),
      this.notices.exists({ ...scope, readAt: null }),
    ]);
    return {
      items: notices.slice(0, limit).map((notice) => ({
        id: notice._id.toHexString(),
        clubId: notice.clubId,
        clubName,
        orderId: notice.orderId.toHexString(),
        publishedAt: notice.publishedAt,
        type: 'important' as const,
        targetApp: 'employee' as const,
        readAt: notice.readAt,
      })),
      hasUnread: Boolean(unread),
      nextCursor:
        notices.length > limit
          ? notices[limit - 1].publicationId.toHexString()
          : null,
    };
  }

  async unread(userId: string) {
    const { scope } = await this.inboxScope(userId);
    return {
      hasUnread: Boolean(await this.notices.exists({ ...scope, readAt: null })),
    };
  }

  async markRead(userId: string, noticeId: string) {
    if (!isObjectIdOrHexString(noticeId))
      throw new BadRequestException('通知标识格式无效');
    const { scope } = await this.inboxScope(userId);
    const notice = await this.notices
      .findOneAndUpdate(
        { ...scope, _id: noticeId },
        [{ $set: { readAt: { $ifNull: ['$readAt', '$$NOW'] } } }],
        {
          returnDocument: 'after',
          updatePipeline: true,
          projection: { readAt: 1 },
        },
      )
      .lean();
    if (!notice) throw new NotFoundException('通知不存在');
    return { id: notice._id.toHexString(), readAt: notice.readAt };
  }

  private async inboxScope(userId: string) {
    const club = await this.directory.getEmployeeClub(userId);
    return {
      clubName: club?.name,
      scope: { recipientUserId: userId, clubId: club ? CLUB_ID : { $in: [] } },
    };
  }

  private async deliverReady() {
    const orders = await this.orders
      .find({
        clubId: CLUB_ID,
        'publication.pending': true,
        'publication.nextAttemptAt': { $lte: new Date() },
      })
      .readConcern('majority')
      .select({ publication: 1 })
      .sort({ 'publication.nextAttemptAt': 1, _id: 1 })
      .limit(ORDER_BATCH_SIZE)
      .lean();
    for (const { _id, publication } of orders) {
      if (!publication) continue;
      const pending = {
        _id,
        'publication.id': publication.id,
        'publication.pending': true,
      };
      try {
        await this.deliver(publication);
        await this.orders.updateOne(
          pending,
          {
            $set: {
              'publication.pending': false,
              'publication.deliveredAt': new Date(),
            },
          },
          { timestamps: false, writeConcern: DURABLE_WRITE },
        );
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : 'unknown';
        this.logger.warn(
          `派单通知 ${publication.id.toHexString()} 待重试，错误码 ${code}`,
        );
        await this.orders.updateOne(
          {
            ...pending,
            'publication.nextAttemptAt': publication.nextAttemptAt,
          },
          {
            $set: {
              'publication.nextAttemptAt': new Date(
                Date.now() + RETRY_DELAY_MS,
              ),
            },
          },
          { timestamps: false, writeConcern: DURABLE_WRITE },
        );
      }
    }
  }

  private async deliver(publication: DispatchPublication) {
    const {
      id: publicationId,
      clubId,
      orderId,
      publishedAt,
      recipientUserIds,
    } = publication;
    for (
      let start = 0;
      start < recipientUserIds.length;
      start += RECIPIENT_BATCH_SIZE
    ) {
      const batch = recipientUserIds.slice(start, start + RECIPIENT_BATCH_SIZE);
      // A failed batch can already contain inserts, and other processes can be
      // replaying this event. Preserve every record already written.
      await this.notices.bulkWrite(
        batch.map((recipientUserId) => ({
          updateOne: {
            filter: { publicationId, recipientUserId },
            update: {
              $setOnInsert: {
                clubId, orderId, publishedAt, type: 'important', targetApp: 'employee', readAt: null,
              },
            },
            upsert: true,
          },
        })),
        { ordered: false, writeConcern: DURABLE_WRITE },
      );
    }
  }
}
