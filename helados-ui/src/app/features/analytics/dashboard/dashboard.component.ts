import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { SummaryData, TopItemsData, ReconciliationSummaryData } from '../../../core/models/analytics.model';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  private analyticsSvc = inject(AnalyticsService);

  fromDate = '';
  toDate   = '';

  summary:     SummaryData               | null = null;
  topItems:    TopItemsData              | null = null;
  reconSummary: ReconciliationSummaryData | null = null;

  loading = false;
  error   = '';

  ngOnInit() {
    const today   = new Date();
    const weekAgo = new Date();
    weekAgo.setDate(today.getDate() - 6);
    this.fromDate = weekAgo.toISOString().split('T')[0];
    this.toDate   = today.toISOString().split('T')[0];
    this.load();
  }

  load() {
    this.loading = true;
    this.error   = '';
    forkJoin({
      summary:      this.analyticsSvc.getSummary(this.fromDate, this.toDate),
      topItems:     this.analyticsSvc.getTopItems(this.fromDate, this.toDate),
      reconSummary: this.analyticsSvc.getReconciliationSummary(this.fromDate, this.toDate),
    }).subscribe({
      next: ({ summary, topItems, reconSummary }) => {
        this.summary      = summary;
        this.topItems     = topItems;
        this.reconSummary = reconSummary;
        this.loading      = false;
      },
      error: () => {
        this.error   = 'Error al cargar datos';
        this.loading = false;
      },
    });
  }

  setLastDays(days: number) {
    const today = new Date();
    const from  = new Date();
    from.setDate(today.getDate() - (days - 1));
    this.fromDate = from.toISOString().split('T')[0];
    this.toDate   = today.toISOString().split('T')[0];
    this.load();
  }

  maxFlavorCount():  number { return this.topItems?.topFlavors?.[0]?.count    ?? 1; }
  maxToppingQty():   number { return this.topItems?.topToppings?.[0]?.quantity ?? 1; }

  // Variance = actual - system (null when no reconciliation summary loaded)
  totalVariance(): number | null {
    if (!this.reconSummary) return null;
    return this.reconSummary.actualTotal - this.reconSummary.systemTotal;
  }

  cashVariance(): number | null {
    if (!this.reconSummary) return null;
    return this.reconSummary.actualCash - this.reconSummary.systemCash;
  }

  qrVariance(): number | null {
    if (!this.reconSummary) return null;
    return this.reconSummary.actualQr - this.reconSummary.systemQr;
  }

  varianceClass(v: number | null): string {
    if (v === null || v === 0) return 'text-gray-500';
    return v > 0 ? 'text-green-400' : 'text-red-400';
  }

  formatVariance(v: number | null): string {
    if (v === null) return '—';
    const sign = v > 0 ? '+' : v < 0 ? '−' : '';
    return `${sign}$${Math.abs(v).toFixed(2)}`;
  }

  formatPrice(n: number) { return `$${Number(n).toFixed(2)}`; }
}
