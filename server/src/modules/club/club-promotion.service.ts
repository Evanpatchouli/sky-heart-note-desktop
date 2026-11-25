import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  MAX_PROMOTIONAL_GIFT_DIVISOR, platformDiscountForService, splitGiftQuoteDiscounts,
  type ClubPromotionPolicy, type GiftPriceSegment, type GiftQuotePromotions, type PlatformPromotionSource, type PlatformPromotionTerms,
} from '@sky-club/common';
import { Model } from 'mongoose';
import type { SessionUser } from '../../auth/app-access';
import { isDuplicateKey } from '../user-module/user-id';
import { ClubCustomerService } from './club-customer.service';
import { ClubDirectoryService } from './club-directory.service';
import { ClubOrder } from './club-order.schema';
import type { IssueClubCouponDto, UpdateClubPromotionDto } from './club-promotion.dto';
import { ClubPromotionCoupon } from './club-promotion.schema';
import { Club } from './club.schema';

const emptyPolicy: ClubPromotionPolicy = { version: 0, activity: null };

function couponSource(coupon: ClubPromotionCoupon): PlatformPromotionSource {
  return {
    ...coupon.terms, id: coupon._id, version: 1, name: coupon.name, clubId: coupon.clubId, couponId: coupon._id,
  };
}

function couponTerms(input: IssueClubCouponDto): PlatformPromotionTerms {
  const { kind, payableBasisPoints, thresholdCents, discountCents } = input;
  if (kind === 'rate_coupon' && payableBasisPoints !== undefined && thresholdCents === undefined && discountCents === undefined)
    return { kind, payableBasisPoints };
  if (kind === 'threshold_coupon' && thresholdCents !== undefined && discountCents !== undefined &&
      discountCents <= thresholdCents && payableBasisPoints === undefined)
    return { kind, thresholdCents, discountCents };
  throw new BadRequestException('请填写对应券种的折扣或满减金额，减免金额不得高于门槛');
}

@Injectable()
export class ClubPromotionService {
  constructor(
    @InjectModel(Club.name) private readonly clubs: Model<Club>,
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    @InjectModel(ClubPromotionCoupon.name) private readonly coupons: Model<ClubPromotionCoupon>,
    private readonly directory: ClubDirectoryService,
    private readonly customers: ClubCustomerService,
  ) {}

  async readAdminPolicy(clubId: string, actor: SessionUser) {
    await this.directory.requireAdminPermission(clubId, actor, 'CLUB_COMMISSION_MANAGE');
    return this.readPolicy(clubId);
  }

  async updatePolicy(clubId: string, actor: SessionUser, input: UpdateClubPromotionDto) {
    await this.directory.requireAdminPermission(clubId, actor, 'CLUB_COMMISSION_MANAGE');
    const { expectedVersion, activityPayableBasisPoints } = input;
    const name = input.activityName?.trim();
    if (activityPayableBasisPoints === undefined ? !!name : !name)
      throw new BadRequestException('请同时填写活动名称和实付折扣，或同时留空停用活动');
    const promotionPolicy = {
      version: expectedVersion + 1,
      activity: activityPayableBasisPoints === undefined ? null : { name: name!, payableBasisPoints: activityPayableBasisPoints },
    };
    const { matchedCount } = await this.clubs.updateOne({
      _id: clubId, 'promotionPolicy.version': expectedVersion || { $exists: false },
    }, { $set: { promotionPolicy } });
    if (!matchedCount) throw new ConflictException('平台优惠规则已变更，请重新加载');
    return promotionPolicy;
  }

  async issueCoupon(clubId: string, actor: SessionUser, input: IssueClubCouponDto) {
    await this.directory.requireAdminPermission(clubId, actor, 'CLUB_COMMISSION_MANAGE');
    await this.customers.requireExisting(input.customerUserId);
    const terms = couponTerms(input);
    const name = input.name.trim();
    if (!name) throw new BadRequestException('请填写优惠券名称');
    const coupon = { _id: input.requestId, clubId, customerUserId: input.customerUserId, issuedByUserId: actor.id, name, terms };
    try {
      await this.coupons.create(coupon);
    } catch (error) {
      if (!isDuplicateKey(error, '_id')) throw error;
      const saved = await this.coupons.findById(coupon._id).lean();
      if (saved?.clubId !== clubId || saved?.customerUserId !== coupon.customerUserId ||
          saved?.issuedByUserId !== actor.id || saved.name !== name || JSON.stringify(saved.terms) !== JSON.stringify(terms))
        throw new ConflictException('相同提交标识已用于不同的优惠券');
    }
    return couponSource(coupon);
  }

  async readPolicy(clubId: string) {
    return (await this.clubs.findById(clubId).select({ promotionPolicy: 1 }).lean())?.promotionPolicy ?? emptyPolicy;
  }

  async availableCoupons(clubId: string, customerUserId: string) {
    const owned = await this.coupons.find({ clubId, customerUserId }).sort({ _id: 1 }).lean();
    if (!owned.length) return [];
    const uses = await this.orders.find({ activePromotionCouponId: { $in: owned.map(item => item._id) } })
      .select({ activePromotionCouponId: 1, _id: 0 }).lean();
    const used = new Set(uses.map(row => row.activePromotionCouponId));
    return owned.filter(coupon => !used.has(coupon._id)).map(couponSource);
  }

  async requireAvailableCoupon(clubId: string, customerUserId: string | undefined, couponId: string) {
    const available = customerUserId && await this.findAvailableCoupon(clubId, customerUserId, couponId);
    if (!available) throw new BadRequestException('优惠券须归本团本单老板所有，且尚未使用');
    return available;
  }

  private async findAvailableCoupon(clubId: string, customerUserId: string, couponId: string) {
    const [coupon, use] = await Promise.all([
      this.coupons.findOne({ _id: couponId, clubId, customerUserId }).lean(),
      this.orders.exists({ activePromotionCouponId: couponId }),
    ]);
    return coupon && !use ? couponSource(coupon) : undefined;
  }

  async quote(
    order: ClubOrder, segments: GiftPriceSegment[], originalServiceCents: number, paidGiftTimes: number,
    personalCents: number, selectedCouponId: string | null, explicitCouponChoice: boolean,
    giftTimesBySegment: number[],
  ): Promise<GiftQuotePromotions> {
    const [policy, coupon] = await Promise.all([
      this.readPolicy(order.clubId),
      selectedCouponId && order.customerUserId && order.customerLinkStatus === 'verified'
        ? this.findAvailableCoupon(order.clubId, order.customerUserId, selectedCouponId)
        : undefined,
    ]);
    if (explicitCouponChoice && selectedCouponId && !coupon)
      throw new BadRequestException('优惠券须归本团本单老板所有，且尚未使用');
    const couponAmount = coupon ? platformDiscountForService(coupon, originalServiceCents) : null;
    const couponIssue = selectedCouponId ? !coupon ? 'unavailable' : couponAmount === null ? 'threshold' : undefined : undefined;
    const activity = policy.activity && {
      kind: 'activity' as const, clubId: order.clubId, id: order.clubId, version: policy.version, ...policy.activity,
    };
    const platform = coupon && couponAmount !== null ? { ...coupon, amountCents: couponAmount } :
      activity ? { ...activity, amountCents: platformDiscountForService(activity, originalServiceCents)! } : undefined;
    const platformCents = platform?.amountCents ?? 0;
    if (personalCents > originalServiceCents - platformCents)
      throw new BadRequestException('个人让利不得高于平台优惠后的服务款');
    const giftSegments = segments.flatMap((segment, sourceSegmentIndex) => {
      const promotionalGiftTimes = giftTimesBySegment[sourceSegmentIndex];
      return promotionalGiftTimes ? [{
        sourceSegmentIndex, promotionalGiftTimes, dailyGiftTimes: Math.min(segment.dailyGiftTimes, promotionalGiftTimes),
      }] : [];
    });
    const giftTimes = giftSegments.reduce((sum, segment) => sum + segment.promotionalGiftTimes, 0);
    if (giftTimes > Math.floor(paidGiftTimes / MAX_PROMOTIONAL_GIFT_DIVISOR))
      throw new BadRequestException('促销赠送次数不得超过整单非赠送付费次数的 10%');
    const totalGiftTimes = paidGiftTimes + giftTimes;
    const gross = giftSegments.reduce((sum, segment) => sum + BigInt(segment.promotionalGiftTimes) *
      BigInt(segments[segment.sourceSegmentIndex].unitPriceCents), BigInt(originalServiceCents));
    if (!Number.isSafeInteger(totalGiftTimes) || gross > BigInt(Number.MAX_SAFE_INTEGER))
      throw new BadRequestException('促销赠送后的履约数量或服务成本超出范围');
    return {
      originalServiceCents,
      selectedCouponId,
      ...(couponIssue ? { couponIssue } : {}),
      ...(platform ? { platform } : {}),
      ...(personalCents ? { personal: { dispatcherUserId: order.dispatcherUserId!, amountCents: personalCents } } : {}),
      segmentDiscounts: splitGiftQuoteDiscounts(segments, platformCents, personalCents),
      ...(giftTimes ? { gift: {
        clubId: order.clubId, dispatcherUserId: order.dispatcherUserId!,
        segments: giftSegments,
      } } : {}),
      totalGiftTimes,
    };
  }
}
