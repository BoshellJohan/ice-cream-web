import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Coupon, CreateCouponPayload, CouponValidation } from '../models/coupon.model';

@Injectable({ providedIn: 'root' })
export class CouponService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/coupons`;

  getAll() {
    return this.http.get<Coupon[]>(this.url);
  }

  create(body: CreateCouponPayload) {
    return this.http.post<Coupon>(this.url, body);
  }

  deactivate(id: string) {
    return this.http.patch<Coupon>(`${this.url}/${id}/deactivate`, {});
  }

  validate(code: string) {
    return this.http.post<CouponValidation>(`${this.url}/validate`, { code });
  }
}
