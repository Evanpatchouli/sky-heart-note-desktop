import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomUUID } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { generateRequestDetails } from 'web-push';
import type { WebApp } from '../../auth/app-access';
import { AppSessionService } from '../../auth/app-session.service';
import { AppNotificationEvent } from './app-notification.schema';
import { ClubDirectoryService } from './club-directory.service';
import { ClubDispatchNotice, type DispatchPublication } from './club-dispatch-notice.schema';
import { base64url, p256PublicKey, pushEndpoint, readPushOrigins, readVapid } from './club-dispatch-push.config';
import { ClubDispatchPushDelivery, ClubDispatchPushSubscription, type PushState } from './club-dispatch-push.schema';
import { postPushRequest, type PushResponse } from './club-dispatch-push.transport';
import { ClubOrder } from './club-order.schema';
import { CLUB_ID } from './club.schema';

const TTL_MS = 15 * 60_000;
const LEASE_MS = 60_000;
const REQUEST_MS = 10_000;
const POLL_MS = 1_000;
const MAX_ACTIVE_SENDS = 4;
const DURABLE = { writeConcern: { w: 'majority', j: true } } as const;
const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
const appScope = (app: WebApp) => app === 'employee'
  ? { $in: ['employee', null] }
  : app;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

function retryAfterTime(response: PushResponse | undefined, now: number) {
  const value = response?.headers['retry-after'];
  if (typeof value !== 'string') return now;
  const timestamp = /^\d+$/.test(value) ? now + Number(value) * 1000 : Date.parse(value);
  return Number.isNaN(timestamp) ? now : timestamp;
}

function subscriptionError(error: unknown): never {
  if (error instanceof HttpException) throw error;
  if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
    throw new ConflictException('设备订阅已更新，请重试');
  }
  // MongoDB validation and transport errors can include subscription secrets.
  throw new ServiceUnavailableException('暂时无法保存接单提醒，请重试');
}

@Injectable()
export class ClubDispatchPushService implements OnModuleInit, OnModuleDestroy {
  private readonly vapid = readVapid();
  private readonly origins = readPushOrigins();
  private readonly logger = new Logger(ClubDispatchPushService.name);
  private timer?: NodeJS.Timeout;
  private planning?: Promise<void>;
  private readonly sending = new Set<Promise<unknown>>();

  constructor(
    @InjectModel(ClubDispatchPushSubscription.name)
    private readonly subscriptions: Model<ClubDispatchPushSubscription>,
    @InjectModel(ClubDispatchPushDelivery.name)
    private readonly deliveries: Model<ClubDispatchPushDelivery>,
    @InjectModel(ClubDispatchNotice.name)
    private readonly notices: Model<ClubDispatchNotice>,
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    @InjectModel(AppNotificationEvent.name) private readonly events: Model<AppNotificationEvent>,
    private readonly sessions: AppSessionService,
    private readonly directory: ClubDirectoryService,
  ) {}

  async onModuleInit() {
    await Promise.all([this.subscriptions.init(), this.deliveries.init()]);
    if (!this.vapid && [
      process.env.WEB_PUSH_VAPID_PUBLIC_KEY,
      process.env.WEB_PUSH_VAPID_PRIVATE_KEY,
      process.env.WEB_PUSH_VAPID_SUBJECT,
    ].some(Boolean)) this.logger.warn('接单提醒 VAPID 配置无效，系统推送已停用');
  }

  publicationSchedule(publishedAt: Date) {
    return this.vapid ? { pushNextAttemptAt: publishedAt } : {};
  }

  startDelivery() {
    if (!this.vapid || this.timer) return;
    const poll = () => {
      this.planning ??= Promise.allSettled([this.plan(), this.planAppNotifications()]).then(results => {
        if (results.some(result => result.status === 'rejected')) throw new Error('通知准备未完成');
      })
        .catch(() => this.logger.warn('暂时无法准备接单提醒，后台将重试'))
        .finally(() => { this.planning = undefined; });
      while (this.sending.size < MAX_ACTIVE_SENDS) {
        const send = this.deliverOne()
          .catch(() => this.logger.warn('接单提醒任务未完成，后台将重新领取'))
          .finally(() => { this.sending.delete(send); });
        this.sending.add(send);
      }
    };
    this.timer = setInterval(poll, POLL_MS).unref();
    poll();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await Promise.all([this.planning, ...this.sending]);
  }

  async status(token: string, userId: string, app: WebApp = 'employee') {
    const { sessionId, accessHash } = await this.sessions.appBinding(token, userId, app);
    const publicKey = this.vapid?.publicKey ?? null;
    const subscription = publicKey && await this.subscriptions
      .findOne({ sessionId, accessHash, publicKey, userId, targetApp: appScope(app), expiresAt: { $gt: new Date() } })
      .select({ endpoint: 1, fingerprint: 1 })
      .lean();
    return {
      publicKey,
      fingerprint: subscription && pushEndpoint(subscription.endpoint, this.origins)
        ? subscription.fingerprint
        : null,
    };
  }

  async enable(token: string, userId: string, value: unknown, targetApp?: WebApp) {
    if (!this.vapid) throw new ServiceUnavailableException('服务器尚未配置接单提醒');
    const publicKey = this.vapid.publicKey;
    const { endpoint, keys, applicationServerKey } = record(value);
    if (applicationServerKey !== publicKey) {
      throw new ConflictException('接单提醒配置已更新，请刷新后重试');
    }
    const url = pushEndpoint(endpoint, this.origins);
    const p256dh = record(keys).p256dh;
    const auth = record(keys).auth;
    if (!url || typeof p256dh !== 'string' || !p256PublicKey(p256dh) ||
        typeof auth !== 'string' || !base64url(auth, 16)) {
      throw new BadRequestException('浏览器推送地址或订阅密钥无效');
    }
    const binding = await this.sessions.appBinding(token, userId, targetApp ?? 'employee');
    const fingerprint = digest(JSON.stringify([url.href, p256dh, auth]));
    const endpointHash = digest(url.href);
    try {
      const [existingEndpoint, existingSession] = await Promise.all([
        this.subscriptions.findOne({ endpointHash }).lean(),
        this.subscriptions.findOne({ sessionId: binding.sessionId }).lean(),
      ]);
      if (!await this.sessions.isCurrentAppBinding({ ...binding, targetApp })) {
        throw new UnauthorizedException('登录已失效');
      }
      if (existingEndpoint?.sessionId.equals(binding.sessionId) &&
          existingEndpoint.accessHash === binding.accessHash &&
          existingEndpoint.fingerprint === fingerprint && existingEndpoint.publicKey === publicKey &&
          (!targetApp || existingEndpoint.targetApp === targetApp)) {
        return { publicKey, fingerprint };
      }

      if (existingEndpoint && existingSession && !existingSession._id.equals(existingEndpoint._id)) {
        throw new ConflictException('请先关闭此会话的现有提醒，再重新开启');
      }
      if (existingEndpoint && !existingEndpoint.sessionId.equals(binding.sessionId) &&
          await this.sessions.isCurrentAppBinding(existingEndpoint)) {
        throw new ConflictException('此订阅正在使用中，请在浏览器更新订阅后重试');
      }
      const fields = {
        ...binding, targetApp, endpointHash, endpoint: url.href, p256dh, auth, fingerprint,
        publicKey, generation: randomUUID(), boundAt: new Date(),
      };
      const previous = existingEndpoint ?? existingSession;
      if (previous) {
        const result = await this.subscriptions.updateOne(
          { _id: previous._id, generation: previous.generation },
          { $set: fields, $unset: { retryNotBefore: '' } },
          DURABLE,
        );
        if (!result.modifiedCount) throw new ConflictException('设备订阅已更新，请重试');
      } else {
        await new this.subscriptions(fields).save(DURABLE.writeConcern);
      }
      return { publicKey, fingerprint };
    } catch (error) {
      subscriptionError(error);
    }
  }

  async disable(token: string, userId: string, value: unknown, app: WebApp = 'employee') {
    const { fingerprint } = record(value);
    if (fingerprint !== undefined && !base64url(fingerprint, 32)) {
      throw new BadRequestException('设备订阅指纹无效');
    }
    const { sessionId, accessHash } = await this.sessions.appBinding(token, userId, app);
    try {
      const result = await this.subscriptions.deleteOne({
        sessionId, accessHash, userId, targetApp: appScope(app),
        ...(fingerprint === undefined ? {} : { fingerprint }),
      }, DURABLE);
      if (fingerprint !== undefined && !result.deletedCount) return this.status(token, userId, app);
    } catch (error) {
      subscriptionError(error);
    }
    return { publicKey: this.vapid?.publicKey ?? null, fingerprint: null };
  }

  private async plan() {
    const now = new Date();
    const lease = randomUUID();
    const order = await this.orders.findOneAndUpdate(
      { clubId: CLUB_ID, 'publication.pending': false, 'publication.pushNextAttemptAt': { $lte: now } },
      {
        $set: {
          'publication.pushNextAttemptAt': new Date(now.getTime() + LEASE_MS),
          'publication.pushLease': lease,
        },
      },
      {
        sort: { 'publication.pushNextAttemptAt': 1 },
        projection: { publication: 1 },
        returnDocument: 'after',
        timestamps: false,
        ...DURABLE,
      },
    ).lean();
    if (!order?.publication) return;
    const scope = { _id: order._id, 'publication.pushLease': lease };
    const expiresAt = new Date(order.publication.publishedAt.getTime() + TTL_MS);
    try {
      if (expiresAt > now) await this.planRecipients(order.publication, expiresAt);
      await this.orders.updateOne(scope, {
        $unset: { 'publication.pushLease': '', 'publication.pushNextAttemptAt': '' },
      }, { timestamps: false, ...DURABLE });
    } catch (error) {
      await this.orders.updateOne(scope, {
        $set: { 'publication.pushNextAttemptAt': new Date(Date.now() + 5000) },
        $unset: { 'publication.pushLease': '' },
      }, { timestamps: false, ...DURABLE });
      throw error;
    }
  }

  private async planAppNotifications() {
    const now = new Date();
    const lease = randomUUID();
    const event = await this.events.findOneAndUpdate({ pushNextAttemptAt: { $lte: now } }, {
      $set: { pushNextAttemptAt: new Date(now.getTime() + LEASE_MS), pushLease: lease },
    }, { sort: { pushNextAttemptAt: 1 }, returnDocument: 'after', ...DURABLE }).lean();
    if (!event) return;
    const scope = { _id: event._id, pushLease: lease };
    const expiresAt = new Date(event.occurredAt.getTime() + TTL_MS);
    try {
      if (expiresAt > now && event.type !== 'normal') {
        await this.planRecipients({
          id: event._id, clubId: event.clubId, publishedAt: event.occurredAt, recipientUserIds: event.recipientUserIds,
        }, expiresAt, event.targetApp);
      }
      await this.events.updateOne(scope, { $unset: { pushLease: '', pushNextAttemptAt: '' } }, DURABLE);
    } catch (error) {
      await this.events.updateOne(scope, {
        $set: { pushNextAttemptAt: new Date(Date.now() + 5000) }, $unset: { pushLease: '' },
      }, DURABLE);
      throw error;
    }
  }

  private async planRecipients(
    publication: Pick<DispatchPublication, 'id' | 'publishedAt' | 'recipientUserIds'> & { clubId?: string },
    expiresAt: Date,
    targetApp: WebApp = 'employee',
  ) {
    const { id: publicationId, clubId, publishedAt, recipientUserIds } = publication;
    for (let start = 0; start < recipientUserIds.length; start += 100) {
      if (expiresAt <= new Date()) return;
      const userIds = recipientUserIds.slice(start, start + 100);
      const notices = await this.notices.find({ publicationId, targetApp, recipientUserId: { $in: userIds } })
        .select({ recipientUserId: 1 }).lean();
      const noticeIds = new Map(notices.map(notice => [notice.recipientUserId, notice._id]));
      const devices = this.subscriptions.find({
        userId: { $in: [...noticeIds.keys()] },
        targetApp: appScope(targetApp),
        boundAt: { $lte: publishedAt },
        expiresAt: { $gt: publishedAt },
      }).select({ userId: 1, generation: 1 }).lean().cursor();
      await devices.eachAsync(async batch => {
        await this.deliveries.bulkWrite(batch.map(({ _id: subscriptionId, userId, generation }) => ({
          updateOne: {
            filter: { publicationId, subscriptionId },
            update: {
              $setOnInsert: {
                noticeId: noticeIds.get(userId)!, generation, clubId, userId, targetApp,
                state: 'pending', expiresAt, nextAttemptAt: new Date(), attempts: 0,
              },
            },
            upsert: true,
          },
        })), { ordered: false, ...DURABLE });
      }, { batchSize: 100 });
    }
  }

  private async deliverOne() {
    const now = new Date();
    const lease = randomUUID();
    const job = await this.deliveries.findOneAndUpdate(
      { state: 'pending', nextAttemptAt: { $lte: now } },
      {
        $set: { nextAttemptAt: new Date(now.getTime() + LEASE_MS), lease },
        $inc: { attempts: 1 },
      },
      { sort: { nextAttemptAt: 1 }, returnDocument: 'after', ...DURABLE },
    ).lean();
    if (!job) return;
    const scope = { _id: job._id, lease };
    const finish = (state: PushState) =>
      this.deliveries.updateOne(scope, { $set: { state }, $unset: { lease: '' } }, DURABLE);
    const reschedule = (nextAttemptAt: Date) => this.deliveries.updateOne(scope, {
      $set: { nextAttemptAt },
      $unset: { lease: '' },
    }, DURABLE);
    if (job.expiresAt <= now) return finish('expired');
    const targetApp = job.targetApp ?? 'employee';
    const subscriptionScope = {
      _id: job.subscriptionId, generation: job.generation, userId: job.userId,
      publicKey: this.vapid!.publicKey, expiresAt: { $gt: now }, targetApp: appScope(targetApp),
    };
    const subscription = await this.subscriptions.findOne(subscriptionScope).lean();
    if (!subscription || !pushEndpoint(subscription.endpoint, this.origins)) return finish('cancelled');
    const waitForRetry = (retryNotBefore: Date) =>
      retryNotBefore < job.expiresAt
        ? reschedule(retryNotBefore)
        : finish('expired');
    if (subscription.retryNotBefore && subscription.retryNotBefore > now) {
      return waitForRetry(subscription.retryNotBefore);
    }
    try {
      if (job.clubId) await this.directory.requireMember(job.clubId, job.userId);
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) return finish('cancelled');
      throw error;
    }
    const ttl = Math.floor((job.expiresAt.getTime() - Date.now()) / 1000);
    if (ttl < 1) return finish('expired');
    const publicationId = job.publicationId.toHexString();
    const notice = await this.notices.findOne({
      _id: job.noticeId, publicationId: job.publicationId, targetApp, recipientUserId: job.userId,
    }).select({ eventKey: 1, type: 1, target: 1, title: 1, body: 1 }).lean();
    if (!notice || notice.type === 'normal') return finish('cancelled');
    const envelope = {
      deviceBinding: digest('sky-heart:push:' + subscription.accessHash),
      expiresAt: job.expiresAt.getTime(),
    };
    const noticeId = job.noticeId.toHexString();
    const payload = notice.eventKey ? {
      ...envelope, type: 'app-notification', version: 1, targetApp, noticeType: notice.type,
      notificationId: publicationId, noticeId,
      target: notice.target, title: notice.title ?? '送心手记', message: notice.body ?? '你有一条新通知，点击查看',
    } : {
      ...envelope, type: 'club-dispatch', version: 1, message: '有新派单，点击进入接单区',
      publicationId, noticeId,
    };
    const details = generateRequestDetails({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    }, JSON.stringify(payload), { vapidDetails: this.vapid!, contentEncoding: 'aes128gcm', TTL: ttl, topic: publicationId });

    // Re-check the specific login generation and endpoint binding at send time.
    if (!await this.deliveries.exists({ ...scope, state: 'pending', nextAttemptAt: { $gt: new Date() } })) {
      return;
    }
    if (!await this.sessions.isCurrentAppBinding(subscription, true)) return finish('cancelled');
    const freshSubscription = await this.subscriptions.findOne(subscriptionScope)
      .select({ retryNotBefore: 1 }).lean();
    if (!freshSubscription) return finish('cancelled');
    if (freshSubscription.retryNotBefore && freshSubscription.retryNotBefore > new Date()) {
      return waitForRetry(freshSubscription.retryNotBefore);
    }
    let response: PushResponse | undefined;
    try {
      const remaining = job.expiresAt.getTime() - Date.now();
      if (remaining < 1000) return finish('expired');
      details.headers.TTL = String(Math.floor(remaining / 1000));
      response = await postPushRequest(details, AbortSignal.timeout(Math.min(REQUEST_MS, remaining)));
    } catch { /* A network failure is eligible for retry without leaking endpoint details. */ }
    const status = response?.statusCode;
    if (status && status >= 200 && status < 300) return finish('accepted');
    if (status === 404 || status === 410) {
      await this.subscriptions.deleteOne(subscriptionScope, DURABLE);
      return finish('cancelled');
    }
    if (status && status !== 429 && status !== 408 && status < 500) return finish('failed');
    const failedAt = Date.now();
    const next = Math.max(
      failedAt + Math.min(5_000 * 2 ** (Math.min(job.attempts, 8) - 1), 120_000),
      retryAfterTime(response, failedAt),
    );
    if (status === 429) {
      const backoff = new Date(Math.min(next, subscription.expiresAt.getTime()));
      await this.subscriptions.updateOne(subscriptionScope, { $max: { retryNotBefore: backoff } }, DURABLE);
    }
    return next < job.expiresAt.getTime() ? reschedule(new Date(next)) : finish('expired');
  }
}
