import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ProductService } from '../../../core/services/product.service';
import { FlavorService } from '../../../core/services/flavor.service';
import { ToppingService } from '../../../core/services/topping.service';
import { CouponService } from '../../../core/services/coupon.service';
import { OrderService } from '../../../core/services/order.service';
import { Product } from '../../../core/models/product.model';
import { Flavor } from '../../../core/models/flavor.model';
import { Topping } from '../../../core/models/topping.model';
import { CouponValidation } from '../../../core/models/coupon.model';
import { CreateOrderPayload, PaymentMethod } from '../../../core/models/order.model';

interface FinishedItem {
  product: Product;
  flavor: Flavor | null;
  toppings: { topping: Topping; quantity: number }[];
  itemTotal: number;
  toppingTotal: number;
}

type Step = 1 | 2 | 3 | 4 | 5;

@Component({
  selector: 'app-new-order',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './new-order.component.html',
})
export class NewOrderComponent implements OnInit {
  private productSvc = inject(ProductService);
  private flavorSvc  = inject(FlavorService);
  private toppingSvc = inject(ToppingService);
  private couponSvc  = inject(CouponService);
  private orderSvc   = inject(OrderService);

  step: Step = 1;
  loading = true;

  products: Product[] = [];
  flavors:  Flavor[]  = [];
  toppings: Topping[] = [];

  items: FinishedItem[] = [];

  draftProduct?: Product;
  draftFlavor?: Flavor;
  toppingQties = new Map<string, number>();

  paymentMethod: PaymentMethod | null = null;

  couponCode = '';
  couponResult: CouponValidation | null = null;
  couponError = '';
  couponLoading = false;

  notes = '';
  submitting = false;
  submitError = '';
  orderSuccess = false;

  ngOnInit() {
    forkJoin({
      products: this.productSvc.getAll(),
      flavors:  this.flavorSvc.getAll(),
      toppings: this.toppingSvc.getAll(),
    }).subscribe({
      next: ({ products, flavors, toppings }) => {
        this.products = products.filter(p => p.active);
        this.flavors  = flavors.filter(f => f.active);
        this.toppings = toppings.filter(t => t.active);
        this.loading  = false;
      },
    });
  }

  selectProduct(product: Product) {
    this.draftProduct = product;
    this.draftFlavor  = undefined;
    this.toppingQties.clear();
    if (product.directSale) {
      // Skip flavor and toppings steps for direct-sale products
      this.items.push({
        product,
        flavor:       null,
        toppings:     [],
        itemTotal:    Number(product.basePrice),
        toppingTotal: 0,
      });
      this.draftProduct = undefined;
      this.step = 1;
    } else {
      this.step = 2;
    }
  }

  selectFlavor(flavor: Flavor) {
    this.draftFlavor = flavor;
    this.toppingQties.clear();
    this.step = 3;
  }

  backToStep1() {
    this.draftProduct = undefined;
    this.draftFlavor  = undefined;
    this.toppingQties.clear();
    this.step = 1;
  }

  backToStep2() { this.step = 2; }

  getToppingQty(toppingId: string): number {
    return this.toppingQties.get(toppingId) ?? 0;
  }

  adjustTopping(toppingId: string, delta: number) {
    const next = Math.max(0, (this.toppingQties.get(toppingId) ?? 0) + delta);
    if (next === 0) this.toppingQties.delete(toppingId);
    else            this.toppingQties.set(toppingId, next);
  }

  private buildFinishedItem(): FinishedItem {
    const product      = this.draftProduct!;
    const flavor       = this.draftFlavor!;
    const itemTotal    = Number(product.basePrice) + Number(flavor.priceModifier);
    const toppingsList = this.toppings
      .filter(t => (this.toppingQties.get(t.id) ?? 0) > 0)
      .map(t => ({ topping: t, quantity: this.toppingQties.get(t.id)! }));
    const toppingTotal = toppingsList.reduce((s, ts) => s + Number(ts.topping.unitPrice) * ts.quantity, 0);
    return { product, flavor, toppings: toppingsList, itemTotal, toppingTotal };
  }

  addAnotherItem() {
    this.items.push(this.buildFinishedItem());
    this.draftProduct = undefined;
    this.draftFlavor  = undefined;
    this.toppingQties.clear();
    this.step = 1;
  }

  proceedToPayment() {
    this.items.push(this.buildFinishedItem());
    this.draftProduct = undefined;
    this.draftFlavor  = undefined;
    this.toppingQties.clear();
    this.step = 4;
  }

  proceedToPaymentFromCart() {
    this.step = 4;
  }

  validateCoupon() {
    const code = this.couponCode.trim().toUpperCase();
    if (!code) return;
    this.couponLoading = true;
    this.couponError   = '';
    this.couponResult  = null;
    this.couponSvc.validate(code).subscribe({
      next:  (r) => { this.couponResult = r; this.couponLoading = false; },
      error: (e) => { this.couponError = e?.error?.message ?? 'Cupón inválido'; this.couponLoading = false; },
    });
  }

  clearCoupon() {
    this.couponCode   = '';
    this.couponResult = null;
    this.couponError  = '';
  }

  get subtotal(): number {
    return Math.round(this.items.reduce((s, i) => s + i.itemTotal + i.toppingTotal, 0) * 100) / 100;
  }

  get discountAmount(): number {
    if (!this.couponResult) return 0;
    const s = this.subtotal;
    const d = this.couponResult.discountType === 'PERCENTAGE'
      ? s * this.couponResult.discountValue / 100
      : Math.min(this.couponResult.discountValue, s);
    return Math.round(d * 100) / 100;
  }

  get total(): number {
    return Math.round((this.subtotal - this.discountAmount) * 100) / 100;
  }

  placeOrder() {
    if (!this.paymentMethod) return;
    this.submitting  = true;
    this.submitError = '';
    const payload: CreateOrderPayload = {
      paymentMethod: this.paymentMethod,
      items: this.items.map(item => ({
        productId: item.product.id,
        flavorId:  item.flavor?.id,
        toppings:  item.toppings.map(ts => ({ toppingId: ts.topping.id, quantity: ts.quantity })),
      })),
      couponCode: this.couponResult ? this.couponCode.trim().toUpperCase() : undefined,
      notes: this.notes || undefined,
    };
    this.orderSvc.create(payload).subscribe({
      next: () => {
        this.submitting   = false;
        this.orderSuccess = true;
        setTimeout(() => this.resetOrder(), 2500);
      },
      error: (e) => {
        this.submitting  = false;
        this.submitError = e?.error?.message ?? 'Error al registrar pedido';
      },
    });
  }

  resetOrder() {
    this.step          = 1;
    this.items         = [];
    this.draftProduct  = undefined;
    this.draftFlavor   = undefined;
    this.toppingQties.clear();
    this.paymentMethod = null;
    this.couponCode    = '';
    this.couponResult  = null;
    this.couponError   = '';
    this.notes         = '';
    this.submitError   = '';
    this.orderSuccess  = false;
  }

  formatPrice(n: number | string) { return `$${Number(n).toFixed(2)}`; }
}
