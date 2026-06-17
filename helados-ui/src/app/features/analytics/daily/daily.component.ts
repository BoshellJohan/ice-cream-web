import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { DailyData } from '../../../core/models/analytics.model';

@Component({
  selector: 'app-daily',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './daily.component.html',
})
export class DailyComponent implements OnInit {
  private analytics = inject(AnalyticsService);

  dateA = '';
  dateB = '';
  dataA: DailyData | null = null;
  dataB: DailyData | null = null;
  loadingA = false;
  loadingB = false;
  errorA = '';
  errorB = '';
  comparing = false;

  ngOnInit() {
    this.dateA = new Date().toISOString().split('T')[0];
    this.loadA();
  }

  loadA() {
    if (!this.dateA) return;
    this.loadingA = true;
    this.errorA = '';
    this.dataA = null;
    this.analytics.getDaily(this.dateA).subscribe({
      next: (data) => { this.dataA = data; this.loadingA = false; },
      error: () => { this.errorA = 'No se pudo cargar'; this.loadingA = false; },
    });
  }

  loadB() {
    if (!this.dateB) return;
    this.loadingB = true;
    this.errorB = '';
    this.dataB = null;
    this.analytics.getDaily(this.dateB).subscribe({
      next: (data) => { this.dataB = data; this.loadingB = false; },
      error: () => { this.errorB = 'No se pudo cargar'; this.loadingB = false; },
    });
  }

  startComparing() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    this.dateB = yesterday.toISOString().split('T')[0];
    this.comparing = true;
    this.loadB();
  }

  stopComparing() {
    this.comparing = false;
    this.dateB = '';
    this.dataB = null;
    this.errorB = '';
  }

  formatPrice(n: number): string {
    return `$${Number(n).toFixed(2)}`;
  }
}
