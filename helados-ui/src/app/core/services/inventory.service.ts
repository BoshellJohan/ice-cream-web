import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import {
  CreateSnapshotPayload, UpdateSnapshotPayload,
  InventorySnapshot, InventorySnapshotSummary, SnapshotPair,
} from '../models/inventory.model';

@Injectable({ providedIn: 'root' })
export class InventoryApiService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/inventory`;

  getAll() {
    return this.http.get<InventorySnapshotSummary[]>(`${this.url}/snapshots`);
  }

  getDay(date: string) {
    return this.http.get<SnapshotPair>(`${this.url}/snapshots/day`, { params: { date } });
  }

  getOne(id: string) {
    return this.http.get<InventorySnapshot>(`${this.url}/snapshots/${id}`);
  }

  upsert(body: CreateSnapshotPayload) {
    return this.http.post<InventorySnapshot>(`${this.url}/snapshots`, body);
  }

  update(id: string, body: UpdateSnapshotPayload) {
    return this.http.patch<InventorySnapshot>(`${this.url}/snapshots/${id}`, body);
  }
}
