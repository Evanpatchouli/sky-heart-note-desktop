import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { calculateGiftQuote, type ContinuationQuote, type ContinuationRequest, type GiftWindow } from '@webapp-template/common';
import { isObjectIdOrHexString, Model, type QueryFilter } from 'mongoose';
import { ClubDirectoryService } from './club-directory.service';
import { activeGiftSegments, requireGiftWindowCapacity } from './club-gift-allocation';
import { writableGiftDispatch } from './club-gift-execution.service';
import { canContinueGiftOrder } from './club-gift-supervision';
import { ClubOrder } from './club-order.schema';
import type { AddContinuationQuoteDto, ContinuationActionDto, ContinuationWindowDto, RecordContinuationReceiptDto, RequestContinuationDto } from './club-pricing.dto';
import type { StoredContinuationQuote, StoredContinuationRequest } from './club-pricing.schema';

function windowView(window: GiftWindow) {
  return { startDate: window.startDate, endDate: window.endDate };
}

function sameWindow(a?: GiftWindow, b?: GiftWindow) {
  return a?.startDate === b?.startDate && a?.endDate === b?.endDate;
}

function terms(input: Pick<StoredContinuationRequest, 'period' | 'paidGiftTimes' | 'dailyGiftTimes'>) {
  return { period: input.period, paidGiftTimes: input.paidGiftTimes, dailyGiftTimes: input.dailyGiftTimes };
}

function sameTerms(a: Parameters<typeof terms>[0], b: Parameters<typeof terms>[0]) {
  return a.period === b.period && a.paidGiftTimes === b.paidGiftTimes && a.dailyGiftTimes === b.dailyGiftTimes;
}

function requestView(value: StoredContinuationRequest): ContinuationRequest {
  return { ...windowView(value), ...terms(value), requestId: value.requestId, requestedAt: value.requestedAt.toISOString() };
}

function quoteTerms({ requestId, segment, amountCents, customerRequestId, window }: StoredContinuationQuote): ContinuationQuote {
  return {
    requestId, segment: { ...terms(segment), unitPriceCents: segment.unitPriceCents }, amountCents,
    ...(customerRequestId ? { customerRequestId } : {}), ...(window ? { window: windowView(window) } : {}),
  };
}

function acceptanceView(value: NonNullable<StoredContinuationQuote['acceptance']>) {
  return { requestId: value.requestId, acceptedAt: value.acceptedAt.toISOString() };
}

function receiptView(value: NonNullable<StoredContinuationQuote['receipt']>) {
  return { receivedAmountCents: value.receivedAmountCents, receivedAt: value.receivedAt.toISOString() };
}

export function continuationView(order: ClubOrder) {
  return {
    continuationRequests: (order.continuationRequests ?? []).map(requestView),
    continuationQuotes: (order.continuationQuotes ?? []).map(quote => ({
      ...quoteTerms(quote),
      ...(quote.acceptance ? { acceptance: acceptanceView(quote.acceptance) } : {}),
      ...(quote.receipt ? { receipt: receiptView(quote.receipt), segmentIndex: quote.segmentIndex } : {}),
    })),
  };
}

const conflictingRequest = () => new ConflictException('相同提交标识已用于不同的续段操作');

@Injectable()
export class ClubContinuationService {
  constructor(
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    private readonly directory: ClubDirectoryService,
  ) {}

  async request(clubId: string, userId: string, orderId: string, input: RequestContinuationDto) {
    await this.directory.requireClub(clubId);
    if (input.dailyGiftTimes > input.paidGiftTimes) throw new BadRequestException('每日次数不能超过总次数');
    const window = windowView(input);
    requireGiftWindowCapacity(window, input.paidGiftTimes, input.dailyGiftTimes);
    const value = { ...window, ...terms(input), requestedAt: new Date(), requestId: input.requestId };
    return this.mutate(orderId, { clubId, customerUserId: userId, customerLinkStatus: 'verified' }, order => {
      const previous = order.continuationRequests?.find(request => request.requestId === input.requestId);
      if (previous) {
        if (!sameTerms(previous, input) || !sameWindow(previous, window)) throw conflictingRequest();
        return { result: requestView(previous) };
      }
      return {
        result: requestView(value),
        update: { continuationRequests: [...(order.continuationRequests ?? []), value] },
      };
    });
  }

  async quote(clubId: string, userId: string, orderId: string, input: AddContinuationQuoteDto) {
    await this.directory.requireMember(clubId, userId);
    const amounts = calculateGiftQuote([input.segment]);
    if (!amounts) throw new BadRequestException('请核对续段的赠送次数、日量和单价');
    const scope = { clubId, dispatcherUserId: userId };
    return this.mutate(orderId, scope, order => {
      const { requestId, customerRequestId, segment } = input;
      const saved = order.continuationQuotes ?? [];
      const request = customerRequestId && order.continuationRequests?.find(item => item.requestId === customerRequestId);
      const requestedWindow = request ? windowView(request) : undefined;
      const expectedWindow = input.window ?? requestedWindow;
      const previous = saved.find(item => item.requestId === requestId);
      const pricing = order.dispatchPricing;
      const commission = pricing && {
        version: pricing.version, basis: pricing.basis, dispatchFeeCents: pricing.dispatchFeeCents, clubFeeCents: pricing.clubFeeCents,
      };
      if (previous) {
        const initialWindow = previous.windowAddedAfterQuote ? undefined : previous.window;
        if (previous.customerRequestId !== customerRequestId || !sameTerms(previous.segment, segment) ||
            previous.segment.unitPriceCents !== segment.unitPriceCents ||
            !sameWindow(initialWindow, expectedWindow)) throw conflictingRequest();
        const result = quoteTerms(previous);
        if (!expectedWindow) delete result.window;
        return { result: { ...result, commission } };
      }
      if (customerRequestId && !(request && sameTerms(request, segment) && sameWindow(request, expectedWindow)))
        throw new ConflictException('续段报价须沿用老板提交的赠送次数、日量和执行窗口');
      if (customerRequestId && saved.some(item => item.customerRequestId === customerRequestId))
        throw new ConflictException('该续段需求已有报价，请刷新后核对');
      if (expectedWindow) requireGiftWindowCapacity(expectedWindow, segment.paidGiftTimes, segment.dailyGiftTimes);
      const value = {
        requestId, segment: { ...terms(segment), unitPriceCents: segment.unitPriceCents }, amountCents: amounts.amountCents,
        ...(customerRequestId ? { customerRequestId } : {}),
        ...(expectedWindow ? { window: windowView(expectedWindow) } : {}),
      };
      return { result: { ...quoteTerms(value), commission }, update: { continuationQuotes: [...saved, value] } };
    });
  }

  async window(clubId: string, userId: string, orderId: string, quoteId: string, input: ContinuationWindowDto) {
    await this.directory.requireMember(clubId, userId);
    const window = windowView(input);
    return this.mutate(orderId, { clubId, dispatcherUserId: userId }, order => {
      const quote = this.requireQuote(order, quoteId);
      if (quote.window) {
        if (!sameWindow(quote.window, window)) throw new ConflictException('续段执行窗口已确定');
        return { result: window };
      }
      requireGiftWindowCapacity(window, quote.segment.paidGiftTimes, quote.segment.dailyGiftTimes);
      return { result: window, update: this.replaceQuote(order, { ...quote, window, windowAddedAfterQuote: true }) };
    });
  }

  async accept(clubId: string, userId: string, orderId: string, quoteId: string, input: ContinuationActionDto) {
    await this.directory.requireClub(clubId);
    return this.mutate(orderId, { clubId, customerUserId: userId, customerLinkStatus: 'verified' }, order => {
      const quote = this.requireQuote(order, quoteId);
      if (quote.acceptance?.requestId === input.requestId) return { result: acceptanceView(quote.acceptance) };
      if (order.continuationQuotes?.some(item => item.acceptance?.requestId === input.requestId)) throw conflictingRequest();
      if (!quote.window || quote.acceptance) throw new ConflictException('报价尚无执行窗口，或已确认报价');
      const acceptance = { requestId: input.requestId, acceptedAt: new Date() };
      return { result: acceptanceView(acceptance), update: this.replaceQuote(order, { ...quote, acceptance }) };
    });
  }

  async receive(clubId: string, userId: string, orderId: string, quoteId: string, input: RecordContinuationReceiptDto) {
    await this.directory.requireMember(clubId, userId);
    return this.mutate(orderId, { clubId, dispatcherUserId: userId }, order => {
      const quote = this.requireQuote(order, quoteId);
      const receivedAt = new Date(input.receivedAt);
      if (quote.receipt?.requestId === input.requestId) {
        if (quote.receipt.receivedAt.getTime() !== receivedAt.getTime() || quote.receipt.receivedAmountCents !== input.receivedAmountCents)
          throw conflictingRequest();
        return { result: { ...receiptView(quote.receipt), segmentIndex: quote.segmentIndex! } };
      }
      if (order.continuationQuotes?.some(item => item.receipt?.requestId === input.requestId)) throw conflictingRequest();
      if (!quote.window || !quote.acceptance || quote.receipt || input.receivedAmountCents !== quote.amountCents)
        throw new ConflictException('须由老板确认报价并登记足额实收后才能激活续段');
      const active = activeGiftSegments(order);
      const paid = (order.continuationQuotes ?? []).reduce(
        (sum, item) => sum + (item.receipt?.receivedAmountCents ?? 0), order.receipt?.receivedAmountCents ?? 0,
      );
      if (!calculateGiftQuote([...active, quote.segment]) || !Number.isSafeInteger(paid + input.receivedAmountCents))
        throw new BadRequestException('续段后的整单赠送次数或收款金额超出范围');
      const receipt = {
        requestId: input.requestId, receivedAmountCents: input.receivedAmountCents, receivedAt,
        recordedAt: new Date(), recordedByUserId: userId,
      };
      const segmentIndex = active.length;
      return { result: { ...receiptView(receipt), segmentIndex }, update: this.replaceQuote(order, { ...quote, receipt, segmentIndex }) };
    });
  }

  private requireQuote(order: ClubOrder, id: string) {
    const quote = order.continuationQuotes?.find(item => item.requestId === id);
    if (!quote) throw new NotFoundException('未找到此续段报价');
    return quote;
  }

  private replaceQuote(order: ClubOrder, updated: StoredContinuationQuote) {
    return { continuationQuotes: order.continuationQuotes!.map(item => item.requestId === updated.requestId ? updated : item) };
  }

  private async mutate<T>(
    orderId: string,
    scope: QueryFilter<ClubOrder>,
    change: (order: ClubOrder) => { result: T; update?: Pick<ClubOrder, 'continuationRequests' | 'continuationQuotes'> },
  ): Promise<T> {
    if (!isObjectIdOrHexString(orderId)) throw new NotFoundException('未找到订单');
    for (let attempt = 0; attempt < 5; attempt++) {
      const order = await this.orders.findOne({ ...scope, _id: orderId }).lean();
      if (!order) throw new NotFoundException('未找到订单');
      const operation = change(order);
      if (!operation.update) return operation.result;
      if (!canContinueGiftOrder(order)) throw new ConflictException('仅已派发且仍可履约的未结按次订单可办理续段');
      const { modifiedCount } = await this.orders.updateOne({
        ...scope, ...writableGiftDispatch, _id: orderId,
        dispatcherUserId: order.dispatcherUserId ?? null, customerUserId: order.customerUserId ?? null,
        customerLinkStatus: order.customerLinkStatus,
        continuationRevision: order.continuationRevision ?? { $in: [null, 0] },
      }, {
        $set: operation.update, $inc: { continuationRevision: 1 },
      }, { runValidators: true, writeConcern: { w: 'majority', j: true } });
      if (modifiedCount) return operation.result;
    }
    throw new ConflictException('订单续段已变化，请刷新后重试');
  }
}
