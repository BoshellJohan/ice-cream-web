import { DiscountType } from './coupon.model';

export type PaymentMethod = 'QR' | 'CASH';

export interface OrderPaymentEntry {
  method: PaymentMethod;
  amount: number;
}

export interface OrderItemTopping {
  id: string;
  toppingId: string;
  topping: { id: string; name: string };
  quantity: number;
}

export interface OrderItem {
  id: string;
  productId: string;
  product: { id: string; name: string; type: string; size: string; directSale: boolean };
  flavorId: string | null;
  flavor: { id: string; name: string } | null;
  itemTotal: number;
  toppings: OrderItemTopping[];
}

export interface Order {
  id: string;
  staffId: string;
  staff: { id: string; name: string };
  couponId: string | null;
  coupon: { id: string; code: string } | null;
  payments: OrderPaymentEntry[];
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  notes: string | null;
  createdAt: string;
  items: OrderItem[];
}

export interface CreateOrderItemToppingPayload {
  toppingId: string;
  quantity: number;
}

export interface CreateOrderItemPayload {
  productId: string;
  flavorId?: string;
  toppings: CreateOrderItemToppingPayload[];
}

export interface CreateOrderPayload {
  payments: OrderPaymentEntry[];
  items: CreateOrderItemPayload[];
  couponCode?: string;
  notes?: string;
}
