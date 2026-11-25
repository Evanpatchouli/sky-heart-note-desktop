import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  BUSINESS_DATE_PATTERN, dailyRunUnitPriceCents, type ServiceOrderAccounting, type ServiceOrderAction,
  type ServiceOrderPage, type ServiceOrderScope, type ServiceOrderView,
} from '@sky-club/common';
import { createHash, randomInt } from 'node:crypto';
import { isObjectIdOrHexString, Model, Types, type QueryFilter } from 'mongoose';
import type { SessionUser } from '../../auth/app-access';
import { isDuplicateKey } from '../user-module/user-id';
import { ClubCustomerService } from './club-customer.service';
import { ClubDirectoryService } from './club-directory.service';
import { serviceOrderAccounting, serviceOrderPostings } from './club-service-order-accounting';
import type {
  AssignServiceOrderDto, CreateClientServiceOrderDto, CreateEmployeeServiceOrderDto, CreateServiceOrderDto,
  DeliverServiceOrderDto, PublishServiceOrderDto, RefundServiceOrderDto, ServiceOrderQuery, ServiceOrderRequestDto, ServiceOrderUnitDto, StopServiceOrderDto,
} from './club-service-order.dto';
import { ClubServiceOrder } from './club-service-order.schema';
import { CLUB_ID } from './club.schema';

const durable = { writeConcern: { w: 'majority', j: true } } as const;
const dailyRunPrices = { unitPriceCents: dailyRunUnitPriceCents, dispatchFeeCents: 200, clubFeeCents: 100 };
const dayMs = 86_400_000;
const beijingOffset = 8 * 60 * 60 * 1000;

type OrderAccess = { actor: SessionUser; canAssign?: boolean; finance?: boolean; financeScope?: boolean };
type OrderChange = Partial<Pick<ClubServiceOrder, 'status' | 'dispatcherUserId' | 'receipt' | 'publishedAt' |
  'executorUserId' | 'claimedAt' | 'completedAt' | 'deliveries' | 'stop' | 'refunds' | 'close'>>;
const financeOrders: QueryFilter<ClubServiceOrder> = {
  $or: [{ 'receipt.occurredAt': { $type: 'date' } }, { 'close.closedAt': { $type: 'date' } }, { status: 'stopped' }],
};

function dateForUnit(startDate: string, unit: number) {
  return new Date(Date.parse(`${startDate}T00:00:00.000Z`) + (unit - 1) * dayMs).toISOString().split('T')[0];
}

function beijingDate(now: Date) {
  return new Date(now.getTime() + beijingOffset).toISOString().slice(0, 10);
}

function hashInput(fields: readonly unknown[]) {
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

function parseOrderId(id: string) {
  if (!isObjectIdOrHexString(id)) throw new BadRequestException('代跑订单标识格式无效');
  return new Types.ObjectId(id);
}

function checkActive(order: ClubServiceOrder) {
  if (order.status === 'stopped' || order.status === 'completed') throw new ConflictException('本单已完成或已停单');
}

function checkUnit(order: ClubServiceOrder, unit: number) {
  if (unit > order.units) throw new BadRequestException('请选择本单约定的履约日');
}

@Injectable()
export class ClubServiceOrderService implements OnModuleInit {
  constructor(
    @InjectModel(ClubServiceOrder.name) private readonly orders: Model<ClubServiceOrder>,
    private readonly directory: ClubDirectoryService,
    private readonly customers: ClubCustomerService,
  ) {}

  async onModuleInit() {
    await this.orders.init();
  }

  async list(actor: SessionUser, { businessType = 'daily_run', scope, after, limit = 25, source }: ServiceOrderQuery): Promise<ServiceOrderPage> {
    const access = await this.readAccess(actor, scope);
    const orders = await this.orders.find({
      clubId: CLUB_ID, businessType, ...this.listScope(access, scope),
      ...(source ? { source } : {}), ...(after ? { _id: { $lt: parseOrderId(after) } } : {}),
    }).sort({ _id: -1 }).limit(limit + 1).readConcern('majority').lean();
    const items = orders.slice(0, limit).map(order => this.view(order, access));
    return { items, nextCursor: orders.length > limit ? items[limit - 1].id : null };
  }

  async detail(actor: SessionUser, id: string, { scope: requestedScope, businessType = 'daily_run' }: ServiceOrderQuery) {
    const access = await this.readAccess(actor, requestedScope);
    const scope = actor.app === 'employee' ? {
      $or: [{ dispatcherUserId: actor.id }, { executorUserId: actor.id }, { status: 'published' },
        ...(access.canAssign ? [{ status: 'pending_assignment' }] : [])],
    } : actor.app === 'client' ? { customerUserId: actor.id } : access.financeScope ? financeOrders : {};
    return this.view(await this.requireOrder({ ...scope, _id: parseOrderId(id), clubId: CLUB_ID, businessType }), access);
  }

  async createClient(actor: SessionUser, input: CreateClientServiceOrderDto) {
    const access = await this.readAccess(actor);
    const order = await this.create('client_order', actor.id, actor.id, input, input.dispatcherUserId);
    return this.view(order, access);
  }

  async createEmployee(actor: SessionUser, input: CreateEmployeeServiceOrderDto) {
    const access = await this.readAccess(actor);
    const order = await this.create('direct_dispatch', actor.id, input.customerUserId, input);
    return this.view(order, access);
  }

  assign(actor: SessionUser, id: string, { requestId, dispatcherUserId }: AssignServiceOrderDto) {
    return this.mutate(actor, id, 'assign', requestId, [dispatcherUserId], async order => {
      if (order.status !== 'pending_assignment') throw new ConflictException('仅待分配派单人的订单可以分配');
      await this.directory.requireAssignmentCandidate(CLUB_ID, dispatcherUserId);
      return { status: 'pending_dispatch', dispatcherUserId };
    });
  }

  publish(actor: SessionUser, id: string, { requestId, amountCents, occurredAt }: PublishServiceOrderDto) {
    const at = new Date(occurredAt);
    if (!Number.isFinite(at.getTime())) throw new BadRequestException('请输入有效的首款时间');
    return this.mutate(actor, id, 'publish', requestId, [amountCents, at.toISOString()], (order, now) => {
      if (order.status !== 'pending_dispatch') throw new ConflictException('仅待派单的订单可以登记首款并派发');
      if (at > now) throw new BadRequestException('首款时间不能晚于现在');
      if (amountCents !== order.quote.totalCents) throw new BadRequestException('请按本单已冻结的报价核实足额首款');
      return { status: 'published', publishedAt: now, receipt: { amountCents, occurredAt: at, recordedAt: now, recordedByUserId: actor.id } };
    });
  }

  claim(actor: SessionUser, id: string, { requestId }: ServiceOrderRequestDto) {
    return this.mutate(actor, id, 'claim', requestId, [], (order, now) => {
      if (order.status !== 'published') throw new ConflictException('本单已承接或当前无法承接');
      return { status: 'claimed', executorUserId: actor.id, claimedAt: now };
    });
  }

  deliver(actor: SessionUser, id: string, { requestId, unit, evidence }: DeliverServiceOrderDto) {
    return this.mutate(actor, id, 'deliveries', requestId, [unit, evidence], (order, now) => {
      if (order.status !== 'claimed') throw new ConflictException('本单暂无可填报的履约日');
      checkUnit(order, unit);
      const businessDate = dateForUnit(order.startDate, unit);
      if (businessDate > beijingDate(now)) throw new BadRequestException('尚未到该北京业务日，不能提交交付凭据');
      if (order.deliveries.some(delivery => delivery.unit === unit)) throw new ConflictException('该日已提交交付凭据');
      return { deliveries: [...order.deliveries, { unit, businessDate, evidence, submittedAt: now }] };
    });
  }

  accept(actor: SessionUser, id: string, { requestId, unit }: ServiceOrderUnitDto) {
    return this.mutate(actor, id, 'accept', requestId, [unit], (order, now) => {
      if (order.status !== 'claimed') throw new ConflictException('本单暂无可确认的履约日');
      checkUnit(order, unit);
      const delivery = order.deliveries.find(item => item.unit === unit);
      if (!delivery) throw new ConflictException('该日还未提交交付凭据');
      if (delivery.acceptedAt) throw new ConflictException('该日已验收');
      const deliveries = order.deliveries.map(item => item.unit === unit ? { ...item, acceptedAt: now } : item);
      const completed = deliveries.length === order.units && deliveries.every(item => item.acceptedAt);
      return { deliveries, ...(completed ? { status: 'completed', completedAt: now } : {}) };
    });
  }

  stop(actor: SessionUser, id: string, { requestId, reason }: StopServiceOrderDto) {
    return this.mutate(actor, id, 'stop', requestId, [reason], (_order, now) => ({
      status: 'stopped', stop: { reason, stoppedAt: now, stoppedByUserId: actor.id },
    }));
  }

  refund(actor: SessionUser, id: string, { requestId, amountCents, occurredAt, transferReference }: RefundServiceOrderDto) {
    const at = new Date(occurredAt);
    if (!Number.isFinite(at.getTime())) throw new BadRequestException('请输入有效的实退时间');
    return this.mutate(actor, id, 'refund', requestId, [amountCents, at.toISOString(), transferReference], (order, now) => {
      if (order.status !== 'stopped' || !order.receipt || order.close)
        throw new ConflictException('仅已收款、停单且尚未结单的订单可登记实退');
      if (at > now || at < order.receipt.occurredAt) throw new BadRequestException('实退时间须在原收款与当前时间之间');
      const refunds = order.refunds ?? [];
      if (transferReference !== undefined) {
        if (refunds.some(item => item.transferReference === transferReference)) throw new ConflictException('此线下凭据已用于本单实退');
      } else if (refunds.some(item => item.amountCents === amountCents && item.occurredAt.getTime() === at.getTime())) {
        throw new ConflictException('此时间及金额的实退已登记。如为另一笔转账，请填写可区分的线下凭据');
      }
      if (amountCents > serviceOrderAccounting(order).refundRemainingCents) throw new ConflictException('实退金额不能超过待退余额');
      return { refunds: [...refunds, { requestId, amountCents, occurredAt: at, recordedAt: now, recordedByUserId: actor.id, transferReference }] };
    });
  }

  close(actor: SessionUser, id: string, { requestId }: ServiceOrderRequestDto) {
    return this.mutate(actor, id, 'close', requestId, [], (order, now) => {
      const accounting = serviceOrderAccounting(order);
      if (accounting.status !== 'ready_to_close') throw new ConflictException('本单须完成履约或停单并核平款项后才能结单');
      return { close: {
        requestId, closedAt: now, closedByUserId: actor.id, acceptedUnits: accounting.acceptedUnits,
        netReceivedCents: accounting.netReceivedCents, postings: serviceOrderPostings(order, accounting),
      } };
    });
  }

  private async create(source: ClubServiceOrder['source'], actorId: string, customerUserId: string,
    input: CreateServiceOrderDto, requestedDispatcherId?: string) {
    const { businessType, requestId, recipientGameAccount, serviceDescription, startDate, units } = input;
    const key = { clubId: CLUB_ID, businessType, source, createdByUserId: actorId, requestId };
    const creationHash = hashInput([customerUserId, requestedDispatcherId, recipientGameAccount, serviceDescription, startDate, units]);
    const replay = (order: ClubServiceOrder) => {
      if (order.creationHash !== creationHash) throw new ConflictException('相同提交标识已用于创建内容不同的代跑订单');
      return order;
    };
    const original = await this.orders.findOne(key).readConcern('majority').lean();
    if (original) return replay(original);
    if (!BUSINESS_DATE_PATTERN.test(dateForUnit(startDate, units))) throw new BadRequestException('约定的最后一个业务日超出可记录范围');

    try {
      if (source === 'direct_dispatch') await this.customers.requireExisting(customerUserId);
      const dispatcherUserId = source === 'direct_dispatch' ? actorId : await this.selectDispatcher(requestedDispatcherId);
      const quote = { ...dailyRunPrices, totalCents: units * dailyRunPrices.unitPriceCents };
      return (await new this.orders({
        ...key, creationHash, customerUserId, dispatcherUserId, quote, recipientGameAccount, serviceDescription, startDate, units,
        status: dispatcherUserId ? 'pending_dispatch' : 'pending_assignment',
      }).save(durable.writeConcern)).toObject();
    } catch (error) {
      if (!(error instanceof BadRequestException) && !isDuplicateKey(error, 'requestId')) throw error;
      const concurrent = await this.orders.findOne(key).readConcern('majority').lean();
      if (concurrent) return replay(concurrent);
      throw error;
    }
  }

  private async selectDispatcher(requestedId?: string) {
    const candidates = await this.directory.eligibleDispatchers(CLUB_ID, requestedId);
    if (candidates.length) return candidates[requestedId ? 0 : randomInt(candidates.length)];
    if (requestedId) throw new BadRequestException('指定账号不在本俱乐部可选派单人范围内');
  }

  private async mutate(actor: SessionUser, id: string, action: ServiceOrderAction, requestId: string, fields: readonly unknown[],
    change: (order: ClubServiceOrder, now: Date) => OrderChange | Promise<OrderChange>): Promise<ServiceOrderView> {
    const role = this.actionScope(actor, action);
    const inputHash = hashInput(fields);
    const scope = { ...role, clubId: CLUB_ID, _id: parseOrderId(id) };

    // Ownership, the action, its replay key and any state transition commit on
    // the same order. A losing writer validates again against the winning state.
    for (let attempt = 0; attempt < 12; attempt++) {
      const access = await this.readAccess(actor);
      if (action === 'assign' && !access.canAssign) throw new ForbiddenException('仅团长或副团长可分配代跑订单');
      const order = await this.requireOrder(scope);
      const previous = order.commands.find(command => command.requestId === requestId);
      if (previous) {
        if (previous.actorUserId !== actor.id || previous.action !== action || previous.inputHash !== inputHash)
          throw new ConflictException('相同请求标识已用于本单其他操作');
        return this.actionResult(action, order, access);
      }
      if (action !== 'refund' && action !== 'close') checkActive(order);
      const update = await change(order, new Date());
      const saved = await this.orders.findOneAndUpdate({ ...scope, revision: order.revision }, {
        $set: update, $push: { commands: { requestId, action, actorUserId: actor.id, inputHash } }, $inc: { revision: 1 },
      }, { ...durable, runValidators: true, returnDocument: 'after' }).lean();
      if (saved) return this.actionResult(action, saved, access);
    }
    throw new ConflictException('本单正在更新，请刷新后核对');
  }

  private actionResult(action: ServiceOrderAction, order: ClubServiceOrder, access: OrderAccess) {
    if (action !== 'assign') return this.view(order, access);
    // Assignment fixes the dispatcher once. Reconstruct its original receipt
    // from immutable terms without disclosing later work to the assigning user.
    return this.view({
      ...order, status: 'pending_dispatch', executorUserId: undefined, receipt: undefined, stop: undefined,
      close: undefined, refunds: undefined, deliveries: [],
    }, access);
  }

  private actionScope(actor: SessionUser, action: ServiceOrderAction): QueryFilter<ClubServiceOrder> {
    if (actor.app === 'client' && (action === 'accept' || action === 'stop')) return { customerUserId: actor.id };
    if (actor.app !== 'employee' || action === 'accept' || action === 'stop') throw new ForbiddenException('该端不能执行此代跑订单操作');
    if (action === 'assign') return {};
    if (action === 'claim') return { publishedAt: { $type: 'date' } };
    if (action === 'deliveries') return { executorUserId: actor.id };
    return { dispatcherUserId: actor.id };
  }

  private async readAccess(actor: SessionUser, scope?: ServiceOrderScope): Promise<OrderAccess> {
    const financeScope = scope === 'finance';
    if (financeScope && actor.app !== 'admin') throw new ForbiddenException('财务核对须使用管理端会话');
    if (actor.app === 'client') {
      await this.directory.requireClub(CLUB_ID);
      return { actor };
    }
    if (actor.app === 'employee') {
      const member = await this.directory.getEmployeeClub(actor.id);
      if (!member) throw new ForbiddenException('需要本俱乐部有效成员身份');
      return { actor, canAssign: member.canAssignPendingOrders };
    }
    const { permissions } = await this.directory.getAdminClub(actor);
    const finance = permissions.includes('CLUB_FINANCE_READ');
    if (financeScope) {
      if (!finance) throw new ForbiddenException('需要本俱乐部财务核对权限');
      return { actor, finance, financeScope };
    }
    if (!permissions.includes('CLUB_ORDERS_READ')) throw new ForbiddenException('需要本俱乐部订单查阅权限');
    return { actor, finance };
  }

  private listScope({ actor, canAssign, financeScope }: OrderAccess, scope: ServiceOrderScope = 'dispatch'): QueryFilter<ClubServiceOrder> {
    if (actor.app === 'client') return { customerUserId: actor.id };
    if (actor.app === 'admin') return financeScope ? financeOrders : {};
    if (scope === 'board') return { status: 'published' };
    if (scope === 'mine') return { executorUserId: actor.id };
    const dispatch = { dispatcherUserId: actor.id };
    return canAssign ? { $or: [dispatch, { status: 'pending_assignment' }] } : dispatch;
  }

  private async requireOrder(scope: QueryFilter<ClubServiceOrder>) {
    const order = await this.orders.findOne(scope).readConcern('majority').lean();
    if (!order) throw new NotFoundException('代跑订单不存在或不归您办理');
    return order;
  }

  private view(order: ClubServiceOrder, access: OrderAccess): ServiceOrderView {
    const { actor, finance } = access;
    const ownCustomer = actor.app === 'client' && actor.id === order.customerUserId;
    const ownDispatch = actor.app === 'employee' && actor.id === order.dispatcherUserId;
    const ownExecution = actor.app === 'employee' && actor.id === order.executorUserId;
    const actions: ServiceOrderAction[] = [];
    if (order.status === 'pending_assignment' && access.canAssign) actions.push('assign');
    if (order.status === 'pending_dispatch' && ownDispatch) actions.push('publish');
    if (order.status === 'published' && actor.app === 'employee') actions.push('claim');
    if (order.status === 'claimed' && ownExecution) {
      const elapsedDays = Math.max(0, Math.min(order.units, Math.floor((Date.parse(beijingDate(new Date())) - Date.parse(order.startDate)) / dayMs) + 1));
      if (order.deliveries.length < elapsedDays) actions.push('deliveries');
    }
    if (order.status === 'claimed' && ownCustomer && order.deliveries.some(delivery => !delivery.acceptedAt)) actions.push('accept');
    if (ownCustomer && order.status !== 'completed' && order.status !== 'stopped') actions.push('stop');

    const accounting = ownDispatch || access.financeScope ? this.accountingView(order, 'full') :
      ownCustomer ? this.accountingView(order, 'customer') : ownExecution ? this.accountingView(order, 'executor') : undefined;
    if (ownDispatch && accounting?.status === 'refund_pending') actions.push('refund');
    if (ownDispatch && accounting?.status === 'ready_to_close') actions.push('close');

    const showMoney = ownCustomer || ownDispatch || finance;
    const showDetails = ownCustomer || ownDispatch || ownExecution || actor.app === 'admin';
    const { businessType, source, customerUserId, recipientGameAccount, serviceDescription, startDate, units, status } = order;
    return {
      id: order._id.toHexString(), businessType, source, dispatcherUserId: order.dispatcherUserId ?? null,
      executorUserId: order.executorUserId ?? null, serviceDescription, startDate, units, status, actions,
      ...(showDetails ? { customerUserId, recipientGameAccount } : {}),
      deliveries: showDetails ? order.deliveries.toSorted((a, b) => a.unit - b.unit).map(({ unit, businessDate, evidence, submittedAt, acceptedAt }) => ({
        unit, businessDate, evidence, submittedAt: submittedAt.toISOString(), ...(acceptedAt ? { acceptedAt: acceptedAt.toISOString() } : {}),
      })) : [],
      ...(showMoney ? { quote: { unitPriceCents: order.quote.unitPriceCents, totalCents: order.quote.totalCents } } : {}),
      ...(showMoney && order.receipt ? { receipt: { amountCents: order.receipt.amountCents, occurredAt: order.receipt.occurredAt.toISOString() } } : {}),
      ...(showDetails && order.stop ? { stop: { reason: order.stop.reason, stoppedAt: order.stop.stoppedAt.toISOString() } } : {}),
      ...(accounting ? { accounting } : {}),
    };
  }

  private accountingView(order: ClubServiceOrder, audience: 'full' | 'customer' | 'executor'): ServiceOrderAccounting {
    const amounts = serviceOrderAccounting(order);
    const { status, acceptedUnits, closedAt } = amounts;
    const summary = { status, acceptedUnits, ...(closedAt ? { closedAt } : {}) };
    if (audience === 'executor') return { ...summary, rewardCents: amounts.rewardCents };
    if (audience === 'customer') {
      const { receivedCents, refundDueCents, refundedCents, refundRemainingCents, netReceivedCents } = amounts;
      return { ...summary, receivedCents, refundDueCents, refundedCents, refundRemainingCents, netReceivedCents };
    }
    return {
      ...amounts, refunds: (order.refunds ?? []).map(({ amountCents, occurredAt, transferReference }) => ({
        amountCents, occurredAt: occurredAt.toISOString(), ...(transferReference === undefined ? {} : { transferReference }),
      })),
    };
  }
}
