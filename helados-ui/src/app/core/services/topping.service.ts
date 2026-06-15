import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Topping, CreateToppingPayload, UpdateToppingPayload, ToppingType, ToppingTypeConfig } from '../models/topping.model';

@Injectable({ providedIn: 'root' })
export class ToppingService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/toppings`;

  getAll() {
    return this.http.get<Topping[]>(this.url);
  }

  getTypeConfigs() {
    return this.http.get<ToppingTypeConfig[]>(`${this.url}/type-config`);
  }

  updateTypeConfig(type: ToppingType, unitPrice: number) {
    return this.http.patch<ToppingTypeConfig>(`${this.url}/type-config/${type}`, { unitPrice });
  }

  create(body: CreateToppingPayload) {
    return this.http.post<Topping>(this.url, body);
  }

  update(id: string, body: UpdateToppingPayload) {
    return this.http.patch<Topping>(`${this.url}/${id}`, body);
  }

  toggleActive(id: string) {
    return this.http.patch<Topping>(`${this.url}/${id}/toggle-active`, {});
  }
}
