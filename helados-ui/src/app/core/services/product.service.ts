import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Product, CreateProductPayload } from '../models/product.model';

@Injectable({ providedIn: 'root' })
export class ProductService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/products`;

  getAll() {
    return this.http.get<Product[]>(this.url);
  }

  create(body: CreateProductPayload) {
    return this.http.post<Product>(this.url, body);
  }

  update(id: string, body: Partial<CreateProductPayload>) {
    return this.http.patch<Product>(`${this.url}/${id}`, body);
  }

  toggleActive(id: string) {
    return this.http.patch<Product>(`${this.url}/${id}/toggle-active`, {});
  }
}
