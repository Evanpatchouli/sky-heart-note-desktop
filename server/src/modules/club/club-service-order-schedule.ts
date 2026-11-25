import { BadRequestException, ConflictException } from '@nestjs/common';
import { BUSINESS_DATE_PATTERN, companionshipSlotMinutes } from '@sky-club/common';
import type { CreateServiceOrderDto } from './club-service-order.dto';
import type { ClubServiceOrder } from './club-service-order.schema';

const dayMs = 86_400_000;
const slotMs = companionshipSlotMinutes * 60_000;
const beijingOffset = 8 * 60 * 60 * 1000;

export function dateForUnit(startDate: string, unit: number) {
  return new Date(Date.parse(`${startDate}T00:00:00.000Z`) + (unit - 1) * dayMs).toISOString().split('T')[0];
}

export function beijingDate(now: Date) {
  return new Date(now.getTime() + beijingOffset).toISOString().split('T')[0];
}

export function dailyReportableUnits(order: ClubServiceOrder, now: Date) {
  return Math.max(0, Math.min(order.units, Math.floor((Date.parse(beijingDate(now)) - Date.parse(order.startDate)) / dayMs) + 1));
}

function fraction(value: string) {
  return value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? '';
}

export function companionshipTime(value: string) {
  const time = new Date(value);
  if (!Number.isFinite(time.getTime()) || /[1-9]/.test(fraction(value).slice(3)))
    throw new BadRequestException('请输入有效时间，精确到毫秒');
  return time;
}

export function serviceOrderSchedule({ businessType, startDate, units, scheduledStartAt: inputTime }: CreateServiceOrderDto) {
  if (businessType === 'daily_run') {
    if (startDate === undefined || inputTime !== undefined) throw new BadRequestException('代跑须填写首个业务日');
    if (!BUSINESS_DATE_PATTERN.test(dateForUnit(startDate, units))) throw new BadRequestException('约定的最后一个业务日超出可记录范围');
    return { startDate };
  }
  if (inputTime === undefined || startDate !== undefined) throw new BadRequestException('陪玩须填写带时区的预约开始时间');
  const scheduledStartAt = companionshipTime(inputTime);
  if (scheduledStartAt.getTime() % slotMs !== 0 || /[1-9]/.test(fraction(inputTime)))
    throw new BadRequestException('陪玩预约须从北京时间的整点或半点开始');
  const scheduledEndAt = new Date(scheduledStartAt.getTime() + units * slotMs);
  const businessDate = beijingDate(scheduledStartAt);
  if (!BUSINESS_DATE_PATTERN.test(businessDate) || !BUSINESS_DATE_PATTERN.test(beijingDate(scheduledEndAt)))
    throw new BadRequestException('预约时间超出可记录范围');
  return { startDate: businessDate, scheduledStartAt, scheduledEndAt };
}

function scheduledBounds(order: ClubServiceOrder) {
  const { scheduledStartAt, scheduledEndAt } = order;
  if (order.businessType !== 'companionship' || !scheduledStartAt || !scheduledEndAt)
    throw new BadRequestException('此操作仅适用于有预约时段的陪玩订单');
  return { scheduledStartAt, scheduledEndAt };
}

export function companionshipSlotStart(order: ClubServiceOrder, unit: number) {
  return new Date(scheduledBounds(order).scheduledStartAt.getTime() + (unit - 1) * slotMs);
}

export function requireCompanionshipStart(order: ClubServiceOrder, occurredAt: Date, now: Date) {
  const { scheduledStartAt, scheduledEndAt } = scheduledBounds(order);
  if (order.startedAt) throw new ConflictException('此预约已登记开场');
  if (occurredAt < scheduledStartAt || occurredAt >= scheduledEndAt || occurredAt > now)
    throw new BadRequestException('开场时刻须在预约期间内，且不能晚于现在');
}

export function companionshipDeliveryDate(order: ClubServiceOrder, unit: number, finishedAt: Date | undefined, now: Date) {
  if (!order.startedAt) throw new ConflictException('请先登记陪玩开场');
  if (!finishedAt) throw new BadRequestException('请填写该段实际完成时间');
  const { scheduledStartAt, scheduledEndAt } = scheduledBounds(order);
  const end = scheduledStartAt.getTime() + unit * slotMs;
  const start = new Date(end - slotMs);
  if (order.startedAt > start) throw new ConflictException('实际开场时刻未覆盖该段起点');
  if (finishedAt.getTime() < end || finishedAt > scheduledEndAt || finishedAt > now)
    throw new BadRequestException('实际完成时间须不早于该段结束，且不晚于预约结束与当前时间');
  return beijingDate(start);
}

export function hasCompanionshipDelivery(order: ClubServiceOrder, now: Date) {
  if (!order.startedAt || !order.scheduledStartAt) return false;
  const start = order.scheduledStartAt.getTime();
  const first = Math.ceil((order.startedAt.getTime() - start) / slotMs) + 1;
  const last = Math.min(order.units, Math.floor((now.getTime() - start) / slotMs));
  return last - first + 1 > order.deliveries.filter(({ unit }) => unit >= first && unit <= last).length;
}
