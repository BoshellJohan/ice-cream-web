import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { DailyData, SummaryData, TopItemsData } from '../models/analytics.model';

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/analytics`;

  getSummary(from: string, to: string) {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http.get<SummaryData>(`${this.url}/summary`, { params });
  }

  getTopItems(from: string, to: string) {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http.get<TopItemsData>(`${this.url}/top-items`, { params });
  }

  getDaily(date: string) {
    const params = new HttpParams().set('date', date);
    return this.http.get<DailyData>(`${this.url}/daily`, { params });
  }
}
