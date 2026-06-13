import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Topping, CreateToppingPayload } from '../models/topping.model';

@Injectable({ providedIn: 'root' })
export class ToppingService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/toppings`;

  getAll() {
    return this.http.get<Topping[]>(this.url);
  }

  create(body: CreateToppingPayload) {
    return this.http.post<Topping>(this.url, body);
  }

  update(id: string, body: Partial<CreateToppingPayload>) {
    return this.http.patch<Topping>(`${this.url}/${id}`, body);
  }

  toggleActive(id: string) {
    return this.http.patch<Topping>(`${this.url}/${id}/toggle-active`, {});
  }
}
