import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { DailyData, ReconciliationData } from '../../../core/models/analytics.model';

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

  // Reconciliation state
  actualCashA: number | null = null;
  actualQrA:   number | null = null;
  savedReconA: ReconciliationData | null = null;
  savingA = false;
  saveErrorA = false;

  actualCashB: number | null = null;
  actualQrB:   number | null = null;
  savedReconB: ReconciliationData | null = null;
  savingB = false;
  saveErrorB = false;

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
    this.loadReconciliationA();
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
    this.loadReconciliationB();
  }

  loadReconciliationA() {
    this.savedReconA = null;
    this.actualCashA = null;
    this.actualQrA = null;
    this.analytics.getReconciliation(this.dateA).subscribe({
      next: (recon) => {
        this.savedReconA = recon;
        if (recon) {
          this.actualCashA = recon.actualCash;
          this.actualQrA = recon.actualQr;
        }
      },
      error: () => {},
    });
  }

  loadReconciliationB() {
    this.savedReconB = null;
    this.actualCashB = null;
    this.actualQrB = null;
    this.analytics.getReconciliation(this.dateB).subscribe({
      next: (recon) => {
        this.savedReconB = recon;
        if (recon) {
          this.actualCashB = recon.actualCash;
          this.actualQrB = recon.actualQr;
        }
      },
      error: () => {},
    });
  }

  saveReconciliationA() {
    if (this.actualCashA === null || this.actualQrA === null) return;
    this.savingA = true;
    this.saveErrorA = false;
    this.analytics.saveReconciliation(this.dateA, this.actualCashA, this.actualQrA).subscribe({
      next: (recon) => { this.savedReconA = recon; this.savingA = false; },
      error: () => { this.saveErrorA = true; this.savingA = false; },
    });
  }

  saveReconciliationB() {
    if (this.actualCashB === null || this.actualQrB === null) return;
    this.savingB = true;
    this.saveErrorB = false;
    this.analytics.saveReconciliation(this.dateB, this.actualCashB, this.actualQrB).subscribe({
      next: (recon) => { this.savedReconB = recon; this.savingB = false; },
      error: () => { this.saveErrorB = true; this.savingB = false; },
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
    this.savedReconB = null;
    this.actualCashB = null;
    this.actualQrB = null;
    this.saveErrorB = false;
  }

  // Variance = actual - system (null when no input or no system data)
  cashVarianceA(): number | null {
    if (this.actualCashA === null || this.dataA === null) return null;
    return this.actualCashA - this.dataA.cashRevenue;
  }

  qrVarianceA(): number | null {
    if (this.actualQrA === null || this.dataA === null) return null;
    return this.actualQrA - this.dataA.qrRevenue;
  }

  cashVarianceB(): number | null {
    if (this.actualCashB === null || this.dataB === null) return null;
    return this.actualCashB - this.dataB.cashRevenue;
  }

  qrVarianceB(): number | null {
    if (this.actualQrB === null || this.dataB === null) return null;
    return this.actualQrB - this.dataB.qrRevenue;
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

  formatPrice(n: number): string {
    return `$${Number(n).toFixed(2)}`;
  }
}
