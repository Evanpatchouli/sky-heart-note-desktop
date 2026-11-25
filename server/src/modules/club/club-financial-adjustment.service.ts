import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { USER_ID_PATTERN, type PersonalClubBalance } from '@webapp-template/common';
import { isObjectIdOrHexString, Model, Types, type QueryFilter } from 'mongoose';
import type { SessionUser } from '../../auth/app-access';
import { isDuplicateKey } from '../user-module/user-id';
import { AppNotificationService } from './app-notification.service';
import { adjustmentBalance } from './club-adjustment-ledger';
import { ClubDirectoryService } from './club-directory.service';
import type { DecideClubAdjustmentDto, PublishClubPenaltyDto, RecordCompensationRefundDto, RequestClubAdjustmentDto } from './club-financial-adjustment.dto';
import { ClubFinancialAdjustment, type OrderAdjustmentCommand } from './club-financial-adjustment.schema';
import { financialAdjustmentView, personalPenalty, type PostedOrderPenalties } from './club-gift-settlement-adjustments';
import { ClubOrder } from './club-order.schema';
import { settlementBalanceEntries } from './club-settlement-close';
import { CLUB_ID } from './club.schema';

const durable = { writeConcern: { w: 'majority', j: true } } as const;

@Injectable()
export class ClubFinancialAdjustmentService implements OnModuleInit {
  private readonly logger = new Logger(ClubFinancialAdjustmentService.name);

  constructor(
    @InjectModel(ClubFinancialAdjustment.name) private readonly adjustments: Model<ClubFinancialAdjustment>,
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    private readonly directory: ClubDirectoryService,
    private readonly notifications: AppNotificationService,
  ) {}

  async onModuleInit() {
    await this.adjustments.init();
    const pending = this.orders.find({ 'pendingFinancialAdjustment.id': { $exists: true } })
      .select({ pendingFinancialAdjustment: 1 }).lean().cursor();
    for await (const order of pending) {
      try {
        await this.flushOrderAdjustment(order);
      } catch {
        this.logger.warn(`订单 ${order._id.toHexString()} 有待完成的资金调整，将在访问该单时重试`);
      }
    }
  }

  async listPenalties(actor: SessionUser) {
    const club = await this.directory.getAdminClub(actor);
    const canPublish = club.canDecideAdjustments;
    if (!canPublish && !club.permissions.includes('CLUB_FINANCE_READ')) {
      throw new ForbiddenException('需要团长、副团长或财务核对权限');
    }
    const [list, candidates] = await Promise.all([
      this.list({ kind: 'member_penalty' }), canPublish ? this.candidates() : [],
    ]);
    return { ...list, candidates, canPublish };
  }

  async publishPenalty(actor: SessionUser, { orderId, ...input }: PublishClubPenaltyDto) {
    await this.requireLeadership(actor);
    const order = orderId ? await this.requireOrder(orderId) : undefined;
    return this.create(actor.id, orderId, { ...input, kind: 'member_penalty' }, true, order);
  }

  async listOrder(actor: SessionUser, orderId: string) {
    const order = await this.requireDispatchOrder(actor.id, orderId);
    const canRequest = this.canRequest(order);
    const canRequestPenalty = canRequest && !order.closedAt;
    const [list, candidates] = await Promise.all([
      this.list({ orderId: order._id }), canRequestPenalty ? this.candidates() : [],
    ]);
    return { ...list, candidates, canRequest, canRequestPenalty };
  }

  async requestAdjustment(actor: SessionUser, orderId: string, input: RequestClubAdjustmentDto) {
    const order = await this.requireDispatchOrder(actor.id, orderId);
    if (input.kind === 'customer_compensation' && (input.memberUserId !== undefined || !order.customerUserId)) {
      throw new BadRequestException('额外补偿须以本单老板为退款对象');
    }
    return this.create(actor.id, order._id.toHexString(), input, false, order);
  }

  async listApprovals(actor: SessionUser) {
    await this.requireLeadership(actor);
    return this.list({ status: 'pending' });
  }

  async decide(actor: SessionUser, id: string, input: DecideClubAdjustmentDto) {
    await this.requireLeadership(actor);
    this.requireObjectId(id);
    const key = { _id: id, clubId: CLUB_ID };
    const pending = await this.adjustments.findOne({ ...key, status: 'pending', revision: input.expectedRevision }).lean();
    const command = {
      id: new Types.ObjectId(), kind: 'decide' as const, adjustmentId: new Types.ObjectId(id), revision: input.expectedRevision,
      decision: { status: input.decision, decidedByUserId: actor.id, decidedAt: new Date(), decisionReason: input.reason },
    };
    const record = !pending ? null : pending.orderId ?
      await this.runOrderAdjustment(pending.orderId, command, input.decision === 'approved' && pending.kind === 'member_penalty') :
      await this.applyAdjustment(command);
    const saved = record ?? await this.adjustments.findOne(key).readConcern('majority').lean();
    if (!saved) throw new NotFoundException('调整记录不存在');
    if (!record && (input.expectedRevision !== 1 || saved.status !== input.decision ||
      saved.decidedByUserId !== actor.id || saved.decisionReason !== input.reason)) {
      throw new ConflictException('调整状态已变更，请刷新后核对');
    }
    if (hasApprovedPenalty(saved)) this.notify(saved._id);
    return this.adjustmentView(saved);
  }

  async refund(actor: SessionUser, orderId: string, id: string, input: RecordCompensationRefundDto) {
    const order = await this.requireDispatchOrder(actor.id, orderId);
    this.requireObjectId(id);
    const key = { _id: id, clubId: CLUB_ID, orderId: order._id, kind: 'customer_compensation' as const };
    const record = await this.adjustments.findOne(key).readConcern('majority').lean();
    if (!record) throw new NotFoundException('额外补偿不存在');
    if (record.status !== 'approved') throw new ConflictException('额外补偿获批后才能登记实退');

    const { amountCents, expectedRevision, evidence } = input;
    const occurredAt = new Date(input.occurredAt);
    const recordedAt = new Date();
    if (!Number.isFinite(occurredAt.getTime()) || occurredAt > recordedAt) {
      throw new BadRequestException('实退时间须为已经发生的时间');
    }
    if (!order.receipt || occurredAt < order.receipt.receivedAt) {
      throw new BadRequestException('实退时间不能早于本单首笔收款');
    }
    const requestId = `compensation:${id.toLowerCase()}:${input.requestId}`;
    const replay = (adjustment: ClubFinancialAdjustment) => {
      const receipt = adjustment.refunds?.find(refund => refund.requestId === requestId);
      if (!receipt) return null;
      if (receipt.amountCents !== amountCents || receipt.evidence !== evidence ||
        receipt.occurredAt.getTime() !== occurredAt.getTime() || receipt.recordedByUserId !== actor.id) {
        throw new ConflictException('该登记编号已用于另一笔实退');
      }
      return financialAdjustmentView(adjustment);
    };
    const repeated = replay(record);
    if (repeated) return repeated;
    if (record.revision !== expectedRevision) throw new ConflictException('补偿已更新，请刷新后核对');
    const paid = (record.refunds ?? []).reduce((total, item) => total + BigInt(item.amountCents), 0n);
    if (paid + BigInt(amountCents) > BigInt(record.amountCents)) {
      throw new ConflictException('实退金额不能超过该补偿待退金额');
    }
    const saved = await this.runOrderAdjustment(order._id, {
      id: new Types.ObjectId(), kind: 'refund', adjustmentId: record._id, revision: expectedRevision,
      refund: { requestId, amountCents, occurredAt, recordedAt, recordedByUserId: actor.id, evidence },
    });
    if (saved) return financialAdjustmentView(saved);
    const latest = await this.adjustments.findOne(key).readConcern('majority').lean();
    const recovered = latest && replay(latest);
    if (recovered) return recovered;
    throw new ConflictException('补偿已更新，请刷新后核对');
  }

  async personalBalance(actor: SessionUser): Promise<PersonalClubBalance> {
    await this.directory.requireMember(CLUB_ID, actor.id);
    const { settlements, posted } = await this.balanceSettlements(actor.id);
    const records = await this.approvedRecords(actor.id);
    return {
      ...adjustmentBalance(records, actor.id, false, settlements, posted),
      pendingPenalties: records.flatMap(record => {
        const view = financialAdjustmentView(record, settlements.get(record.orderId?.toHexString() ?? ''));
        const { penaltyPosting } = view;
        return penaltyPosting && penaltyPosting !== 'posted' ? [{ ...personalPenalty(view), penaltyPosting }] : [];
      }),
    };
  }

  async financeBalance(actor: SessionUser, userId?: string) {
    await this.directory.requireAdminPermission(CLUB_ID, actor, 'CLUB_FINANCE_READ');
    if (userId !== undefined && !USER_ID_PATTERN.test(userId)) throw new BadRequestException('请输入四位用户 ID');
    const { settlements, posted } = await this.balanceSettlements(userId ?? null);
    const records = await this.approvedRecords(userId);
    return adjustmentBalance(records, userId ?? null, true, settlements, posted);
  }

  private async balanceSettlements(userId: string | null) {
    // Read the close marker and its base and penalty postings from the same document snapshot.
    const orders = await this.orders.find({ clubId: CLUB_ID, closedAt: { $type: 'date' } })
      .select({ closedAt: 1, settlementPenaltyIds: 1, settlementClose: 1, settlementCorrections: 1 }).readConcern('majority').lean();
    const settlements = new Map<string, PostedOrderPenalties>();
    for (const order of orders) {
      settlements.set(order._id.toHexString(), {
        closedAt: order.closedAt!, adjustmentIds: new Set(order.settlementPenaltyIds?.map(id => id.toHexString())),
      });
    }
    return { settlements, posted: orders.flatMap(order => settlementBalanceEntries(order, userId)) };
  }

  private approvedRecords(userId?: string) {
    return this.adjustments.find({ clubId: CLUB_ID, status: 'approved',
      ...(userId ? { kind: 'member_penalty', memberUserId: userId } : {}),
    }).sort({ _id: -1 }).readConcern('majority').lean();
  }

  private async create(userId: string, orderId: string | undefined, input: RequestClubAdjustmentDto,
    direct: boolean, order?: ClubOrder) {
    const { kind, amountCents, reason, memberUserId, requestId } = input;
    const key = { clubId: CLUB_ID, requestedByUserId: userId, requestId };
    const replay = (record: ClubFinancialAdjustment) => {
      if (record.kind !== kind || record.orderId?.toHexString() !== orderId?.toLowerCase() || record.amountCents !== amountCents ||
        record.reason !== reason || record.memberUserId !== memberUserId || (record.status === 'approved' && record.revision === 1) !== direct) {
        throw new ConflictException('该提交编号已用于另一笔调整');
      }
      if (hasApprovedPenalty(record)) this.notify(record._id);
      return this.adjustmentView(record);
    };
    const previous = await this.adjustments.findOne(key).readConcern('majority').lean();
    if (previous) return replay(previous);
    if (kind === 'member_penalty' && order) {
      const issue = this.penaltyOrderIssue(order);
      if (issue) throw new ConflictException(issue);
    }
    if (!direct && order && !this.canRequest(order)) throw new ConflictException('订单收款并派发后才能发起调整');
    if (memberUserId) await this.directory.requireAssignmentCandidate(CLUB_ID, memberUserId);
    const now = new Date();
    const adjustment = new this.adjustments({ ...key, orderId, kind, amountCents, reason, memberUserId,
      ...(kind === 'customer_compensation' ? { customerUserId: order?.customerUserId } : {}),
      status: direct ? 'approved' : 'pending', revision: 1, createdAt: now,
      ...(direct ? { decidedByUserId: userId, decidedAt: now } : {}),
    });
    const command = { id: new Types.ObjectId(), kind: 'create' as const, record: adjustment.toObject() };
    const saved = order ? await this.runOrderAdjustment(order._id, command, kind === 'member_penalty') : await this.applyAdjustment(command);
    if (!saved || !saved._id.equals(adjustment._id)) {
      const concurrent = saved ?? await this.adjustments.findOne(key).readConcern('majority').lean();
      if (concurrent) return replay(concurrent);
      throw new ConflictException('该调整未登记，请刷新后重新核对');
    }
    if (direct) this.notify(saved._id);
    return this.adjustmentView(saved);
  }

  private async list(scope: QueryFilter<ClubFinancialAdjustment>) {
    const rows = await this.adjustments.find({ ...scope, clubId: CLUB_ID }).sort({ _id: -1 }).readConcern('majority').lean();
    const users = new Set<string>();
    for (const row of rows) {
      for (const userId of [row.requestedByUserId, row.decidedByUserId, row.memberUserId, row.customerUserId]) {
        if (userId) users.add(userId);
      }
    }
    const [settlements, names] = await Promise.all([this.settlementsFor(rows), this.directory.memberNicknames([...users])]);
    return {
      records: rows.map(record => financialAdjustmentView(record, settlements.get(record.orderId?.toHexString() ?? ''))),
      memberNames: Object.fromEntries(names),
    };
  }

  // Admission and close compare the same order document. Any instance can finish
  // the admitted mutation before releasing its slot, including after a restart.
  private async runOrderAdjustment(orderId: Types.ObjectId, command: OrderAdjustmentCommand, requireOpen = false) {
    const scope = { _id: orderId, clubId: CLUB_ID };
    for (let attempt = 0; attempt < 12; attempt++) {
      const reserved = await this.orders.updateOne({
        ...scope, pendingFinancialAdjustment: null,
        ...(requireOpen ? {
          closedAt: null, dispatchStatus: { $nin: ['cancelled', 'pending_assignment'] },
          dispatcherUserId: { $type: 'string' },
        } : {}),
      }, { $set: { pendingFinancialAdjustment: command }, $inc: { financialRevision: 1 } }, durable);
      if (reserved.modifiedCount) return this.flushOrderAdjustment({ _id: orderId, pendingFinancialAdjustment: command });
      const owner = await this.orders.findOne(scope).readConcern('majority').lean();
      if (!owner) throw new NotFoundException('本单不存在');
      if (owner.pendingFinancialAdjustment) await this.flushOrderAdjustment(owner);
      if (requireOpen) {
        const issue = this.penaltyOrderIssue(owner);
        if (issue) {
          // If the preceding worker finished the same operation, return its stored
          // record so the caller can validate and replay the original request.
          if (command.kind === 'create') {
            const { clubId, requestedByUserId, requestId } = command.record;
            const saved = await this.adjustments.findOne({ clubId, requestedByUserId, requestId }).readConcern('majority').lean();
            if (saved) return saved;
          } else if (command.kind === 'decide') {
            const saved = await this.adjustments.findOne({ _id: command.adjustmentId, clubId: CLUB_ID }).readConcern('majority').lean();
            if (saved?.status !== 'pending') return null;
          }
          throw new ConflictException(issue);
        }
      }
    }
    throw new ConflictException('本单的资金调整正在更新，请重试');
  }

  async flushOrderAdjustment({ _id, pendingFinancialAdjustment }: Pick<ClubOrder, '_id' | 'pendingFinancialAdjustment'>) {
    if (!pendingFinancialAdjustment) return null;
    const saved = await this.applyAdjustment(pendingFinancialAdjustment);
    await this.orders.updateOne({ _id, 'pendingFinancialAdjustment.id': pendingFinancialAdjustment.id },
      { $unset: { pendingFinancialAdjustment: 1 } }, durable);
    if (saved && hasApprovedPenalty(saved)) this.notify(saved._id);
    return saved;
  }

  private async applyAdjustment(command: OrderAdjustmentCommand) {
    if (command.kind === 'create') {
      try {
        return (await new this.adjustments(command.record).save(durable.writeConcern)).toObject();
      } catch (error) {
        if (isDuplicateKey(error, '_id') || isDuplicateKey(error, 'requestId')) return null;
        throw error;
      }
    }
    const deciding = command.kind === 'decide';
    return this.adjustments.findOneAndUpdate({
      _id: command.adjustmentId, clubId: CLUB_ID, status: deciding ? 'pending' : 'approved', revision: command.revision,
    }, {
      ...(deciding ? { $set: command.decision } : { $push: { refunds: command.refund } }), $inc: { revision: 1 },
    }, { ...durable, returnDocument: 'after', runValidators: true }).lean();
  }

  private async adjustmentView(record: ClubFinancialAdjustment) {
    const settlements = await this.settlementsFor([record]);
    return financialAdjustmentView(record, settlements.get(record.orderId?.toHexString() ?? ''));
  }

  private async settlementsFor(records: ClubFinancialAdjustment[]) {
    const ids = new Set<string>();
    for (const row of records) {
      if (hasApprovedPenalty(row) && row.orderId) ids.add(row.orderId.toHexString());
    }
    const settlements = new Map<string, PostedOrderPenalties>();
    if (!ids.size) return settlements;
    const orders = await this.orders.find({ clubId: CLUB_ID, _id: { $in: [...ids] }, closedAt: { $type: 'date' } })
      .select({ closedAt: 1, settlementPenaltyIds: 1 }).readConcern('majority').lean();
    for (const { _id, closedAt, settlementPenaltyIds } of orders) {
      if (closedAt) settlements.set(_id.toHexString(), {
        closedAt, adjustmentIds: new Set(settlementPenaltyIds?.map(id => id.toHexString())),
      });
    }
    return settlements;
  }

  private async candidates() {
    const userIds = await this.directory.eligibleGiftMembers(CLUB_ID);
    const names = await this.directory.memberNicknames(userIds);
    return userIds.map(userId => ({ userId, nickname: names.get(userId) ?? null }));
  }

  private async requireLeadership(actor: SessionUser) {
    const club = actor.app === 'admin' ? await this.directory.getAdminClub(actor) : await this.directory.getEmployeeClub(actor.id);
    if (!club?.canDecideAdjustments) throw new ForbiddenException('仅本团团长或副团长可办理');
  }

  private async requireOrder(id: string, dispatcherUserId?: string) {
    this.requireObjectId(id);
    const order = await this.orders.findOne({ _id: id, clubId: CLUB_ID, ...(dispatcherUserId ? { dispatcherUserId } : {}) }).lean();
    if (!order) throw new NotFoundException('本单不存在或不归您经办');
    return order;
  }

  private async requireDispatchOrder(userId: string, orderId: string) {
    await this.directory.requireMember(CLUB_ID, userId);
    return this.requireOrder(orderId, userId);
  }

  private canRequest(order: ClubOrder) {
    return order.dispatchStatus === 'published' && order.receipt?.quote.priceUnit === 'gift_times';
  }

  private requireObjectId(id: string) {
    if (!isObjectIdOrHexString(id)) throw new NotFoundException('记录不存在');
  }

  private penaltyOrderIssue(order: ClubOrder) {
    if (order.closedAt) return '订单已结单，无法新增关联罚款';
    if (order.dispatchStatus === 'cancelled') return '订单已取消，无法新增关联罚款';
    if (order.dispatchStatus === 'pending_assignment' || !order.dispatcherUserId) return '订单尚未分配派单人，无法关联罚款';
  }

  private notify(id: Types.ObjectId) {
    void this.notifications.publishApprovedPenalty(id.toHexString())
      .catch(() => this.logger.warn('罚款通知待后台补送'));
  }
}

function hasApprovedPenalty(record: ClubFinancialAdjustment) {
  return record.kind === 'member_penalty' && record.status === 'approved';
}
