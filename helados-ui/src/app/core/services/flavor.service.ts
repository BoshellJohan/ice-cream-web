import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Flavor, CreateFlavorPayload } from '../models/flavor.model';

@Injectable({ providedIn: 'root' })
export class FlavorService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/flavors`;

  getAll() {
    return this.http.get<Flavor[]>(this.url);
  }

  create(body: CreateFlavorPayload) {
    return this.http.post<Flavor>(this.url, body);
  }

  update(id: string, body: Partial<CreateFlavorPayload>) {
    return this.http.patch<Flavor>(`${this.url}/${id}`, body);
  }

  toggleActive(id: string) {
    return this.http.patch<Flavor>(`${this.url}/${id}/toggle-active`, {});
  }
}
