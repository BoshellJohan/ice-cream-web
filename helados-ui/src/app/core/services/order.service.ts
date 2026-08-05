import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Order, CreateOrderPayload, CancelReason } from '../models/order.model';

@Injectable({ providedIn: 'root' })
export class OrderService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/orders`;

  getAll(from?: string, to?: string) {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to)   params = params.set('to', to);
    return this.http.get<Order[]>(this.url, { params });
  }

  getOne(id: string) {
    return this.http.get<Order>(`${this.url}/${id}`);
  }

  create(body: CreateOrderPayload) {
    return this.http.post<Order>(this.url, body);
  }

  cancel(id: string, reason: CancelReason) {
    return this.http.patch<Order>(`${this.url}/${id}/cancel`, { reason });
  }
}
