export type DiscountType = 'PERCENTAGE' | 'FIXED';

export interface Coupon {
  id: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;
  maxUses: number | null;
  usesCount: number;
  validFrom: string | null;
  validUntil: string | null;
  active: boolean;
}

export interface CreateCouponPayload {
  code: string;
  discountType: DiscountType;
  discountValue: number;
  maxUses?: number;
  validFrom?: string;
  validUntil?: string;
}

export interface CouponValidation {
  id: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;
}
