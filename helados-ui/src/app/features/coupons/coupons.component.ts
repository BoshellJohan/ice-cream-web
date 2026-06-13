import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CouponService } from '../../core/services/coupon.service';
import { Coupon, CreateCouponPayload } from '../../core/models/coupon.model';

@Component({
  selector: 'app-coupons',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './coupons.component.html',
})
export class CouponsComponent implements OnInit {
  private couponSvc = inject(CouponService);

  coupons: Coupon[] = [];
  loading = false;
  saving = false;
  error = '';
  showForm = false;

  form: CreateCouponPayload = {
    code: '',
    discountType: 'PERCENTAGE',
    discountValue: 0,
  };

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.couponSvc.getAll().subscribe({
      next: (c) => { this.coupons = c; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  openCreate() {
    this.form = { code: '', discountType: 'PERCENTAGE', discountValue: 0 };
    this.error = '';
    this.showForm = true;
  }

  save() {
    this.saving = true;
    this.error = '';
    this.couponSvc.create(this.form).subscribe({
      next: () => { this.saving = false; this.showForm = false; this.load(); },
      error: (err) => { this.saving = false; this.error = err?.error?.message ?? 'Error al crear'; },
    });
  }

  deactivate(coupon: Coupon) {
    this.couponSvc.deactivate(coupon.id).subscribe({ next: () => this.load(), error: () => {} });
  }

  discountLabel(coupon: Coupon): string {
    return coupon.discountType === 'PERCENTAGE'
      ? `${coupon.discountValue}%`
      : `$${Number(coupon.discountValue).toFixed(2)}`;
  }
}
