import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { AppUser, CreateUserPayload, Role } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class UserAdminService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/users`;

  getAll() {
    return this.http.get<AppUser[]>(this.url);
  }

  create(body: CreateUserPayload) {
    return this.http.post<AppUser>(this.url, body);
  }

  changeRole(id: string, role: Role) {
    return this.http.patch<AppUser>(`${this.url}/${id}/role`, { role });
  }

  deactivate(id: string) {
    return this.http.patch<AppUser>(`${this.url}/${id}/deactivate`, {});
  }
}
