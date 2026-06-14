import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { CreateSnapshotPayload, InventorySnapshot, SnapshotPair } from '../models/inventory.model';

@Injectable({ providedIn: 'root' })
export class InventoryApiService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/inventory`;

  getSnapshots(date: string) {
    return this.http.get<SnapshotPair>(`${this.url}/snapshots`, { params: { date } });
  }

  upsert(body: CreateSnapshotPayload) {
    return this.http.post<InventorySnapshot>(`${this.url}/snapshots`, body);
  }
}
