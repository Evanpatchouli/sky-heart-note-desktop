import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ClubWithdrawal } from '@sky-club/common';
import { isObjectIdOrHexString, Types } from 'mongoose';
import type { SessionUser } from '../../auth/app-access';
import { ClubDirectoryService } from './club-directory.service';
import { ClubFinancialAdjustmentService } from './club-financial-adjustment.service';
import type { DecideClubWithdrawalDto, RecordClubWithdrawalPaymentDto, RequestClubWithdrawalDto } from './club-withdrawal.dto';
import type { ClubWithdrawalMovement } from './club-withdrawal.schema';
import { applyWithdrawalEvent, ClubWithdrawalStore, projectWithdrawals, remainingWithdrawalCents } from './club-withdrawal.store';
import { CLUB_ID } from './club.schema';

type WithdrawalMutation = { movement: ClubWithdrawalMovement } | { saved: ClubWithdrawal };

@Injectable()
export class ClubWithdrawalService {
  constructor(
    private readonly directory: ClubDirectoryService,
    private readonly store: ClubWithdrawalStore,
    private readonly adjustments: ClubFinancialAdjustmentService,
  ) {}

  async listOwn(actor: SessionUser) {
    await this.directory.requireMember(CLUB_ID, actor.id);
    return { items: this.newestFirst(projectWithdrawals(await this.store.history(actor.id))) };
  }

  async listForReview(actor: SessionUser) {
    await this.requireReviewer(actor);
    const items = this.newestFirst(projectWithdrawals(await this.store.history()));
    return { items: items.filter(item => item.status === 'pending') };
  }

  async listForPayment(actor: SessionUser) {
    await this.directory.requireAdminPermission(CLUB_ID, actor, 'CLUB_WITHDRAWAL_PAY');
    const items = this.newestFirst(projectWithdrawals(await this.store.history()));
    return { items: items.filter(item => item.status === 'approved' || item.status === 'paid') };
  }

  async request(actor: SessionUser, { amountCents, requestId }: RequestClubWithdrawalDto) {
    await this.directory.requireMember(CLUB_ID, actor.id);
    const withdrawalId = new Types.ObjectId();
    return this.mutate(actor.id, async items => {
      let reservedAndPaid = 0n;
      for (const item of items.values()) {
        if (item.requestId === requestId) {
          if (item.amountCents !== amountCents) throw new ConflictException('该提交编号已用于另一笔提现申请');
          return { saved: item };
        }
        // For each unrejected request, paid amounts and the remaining reservation
        // together equal the requested amount. Both reduce what can be requested.
        if (item.status !== 'rejected') reservedAndPaid += BigInt(item.amountCents);
      }
      const available = await this.adjustments.memberBalanceBeforeWithdrawals(actor.id) - reservedAndPaid;
      if (BigInt(amountCents) > available) throw new ConflictException('可提现余额不足');

      return { movement: { kind: 'request', withdrawalId, actorUserId: actor.id, amountCents, requestId, occurredAt: new Date() } };
    });
  }

  async decide(actor: SessionUser, id: string, { decision }: DecideClubWithdrawalDto) {
    await this.requireReviewer(actor);
    const { memberUserId, withdrawalId } = await this.requireRequest(id);
    return this.mutate(memberUserId, items => {
      const item = this.requireItem(items, withdrawalId);
      if (item.status !== 'pending') {
        const decided = item.status === 'paid' ? 'approved' : item.status;
        if (decided === decision && item.decidedByUserId === actor.id) return { saved: item };
        throw new ConflictException('提现申请已审批，请刷新后核对');
      }
      return { movement: { kind: decision, withdrawalId, actorUserId: actor.id, occurredAt: new Date() } };
    });
  }

  async pay(actor: SessionUser, id: string, input: RecordClubWithdrawalPaymentDto) {
    await this.directory.requireAdminPermission(CLUB_ID, actor, 'CLUB_WITHDRAWAL_PAY');
    const { memberUserId, withdrawalId } = await this.requireRequest(id);
    const { amountCents, requestId, transferReference } = input;
    const occurredAt = new Date(input.occurredAt);
    if (!Number.isFinite(occurredAt.getTime()) || occurredAt > new Date()) {
      throw new BadRequestException('实付时间须为已经发生的时间');
    }
    const occurredAtIso = occurredAt.toISOString();

    return this.mutate(memberUserId, async items => {
      const item = this.requireItem(items, withdrawalId);
      const recorded = item.payments.find(payment => payment.requestId === requestId);
      if (recorded) {
        if (recorded.amountCents !== amountCents || recorded.occurredAt !== occurredAtIso || recorded.recordedByUserId !== actor.id ||
          recorded.transferReference !== transferReference) {
          throw new ConflictException('该登记编号已用于另一笔实付');
        }
        return { saved: item };
      }
      const used = await this.store.findPayment(requestId);
      if (used && !used.withdrawalId.equals(withdrawalId)) throw new ConflictException('该登记编号已用于另一笔实付');
      if (transferReference !== undefined) {
        if (item.payments.some(payment => payment.transferReference === transferReference)) {
          throw new ConflictException('此线下凭据已用于本申请的实付登记');
        }
      } else if (item.payments.some(payment => payment.amountCents === amountCents && payment.occurredAt === occurredAtIso)) {
        throw new ConflictException('此时间及金额的实付已登记。如为另一笔转账，请填写可区分的线下凭据');
      }
      if (item.status !== 'approved' || !item.decidedAt) throw new ConflictException('只有已批准且尚未付清的提现可登记实付');
      if (occurredAt.getTime() < Date.parse(item.decidedAt)) throw new BadRequestException('实付时间不能早于审批时间');
      if (amountCents > remainingWithdrawalCents(item)) throw new ConflictException('实付金额不能超过待付金额');

      return { movement: { kind: 'payment', withdrawalId, actorUserId: actor.id, requestId, amountCents, occurredAt, transferReference } };
    });
  }

  private async mutate(memberUserId: string, prepare: (items: Map<string, ClubWithdrawal>) =>
    WithdrawalMutation | Promise<WithdrawalMutation>): Promise<ClubWithdrawal> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const history = await this.store.history(memberUserId);
      const items = projectWithdrawals(history);
      const change = await prepare(items);
      if ('saved' in change) return change.saved;
      const sequence = (history.at(-1)?.sequence ?? 0) + 1;
      const event = await this.store.append(memberUserId, sequence, change.movement);
      if (event) return applyWithdrawalEvent(items, event);
    }
    throw new ConflictException('该团员的提现记录正在更新，请重试');
  }

  private async requireReviewer(actor: SessionUser) {
    const club = await this.directory.getEmployeeClub(actor.id);
    if (!club?.canDecideAdjustments) throw new ForbiddenException('仅本团团长或副团长可审批提现');
  }

  private async requireRequest(id: string) {
    if (!isObjectIdOrHexString(id)) throw new NotFoundException('提现申请不存在');
    const event = await this.store.requestedWithdrawal(new Types.ObjectId(id));
    if (!event) throw new NotFoundException('提现申请不存在');
    return event;
  }

  private requireItem(items: Map<string, ClubWithdrawal>, withdrawalId: Types.ObjectId) {
    const item = items.get(withdrawalId.toHexString());
    if (!item) throw new NotFoundException('提现申请不存在');
    return item;
  }

  private newestFirst(items: Map<string, ClubWithdrawal>) {
    return [...items.values()].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt) || b.id.localeCompare(a.id));
  }
}
