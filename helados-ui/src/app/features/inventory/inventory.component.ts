import { Component, OnInit, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProductService } from '../../core/services/product.service';
import { InventoryApiService } from '../../core/services/inventory.service';
import { Product } from '../../core/models/product.model';
import {
  InventorySnapshot, InventorySnapshotSummary,
  InventoryLinePayload, SnapshotPeriod,
} from '../../core/models/inventory.model';

const WATER_LABEL = 'Agua';

interface QtyRow {
  productId?: string;
  label?: string;
  display: string;
  qty: number;
}

type PanelMode = 'none' | 'new' | 'view' | 'edit';

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './inventory.component.html',
})
export class InventoryComponent implements OnInit {
  private productSvc   = inject(ProductService);
  private inventorySvc = inject(InventoryApiService);

  history: InventorySnapshotSummary[] = [];
  loadingHistory = true;
  products: Product[] = [];

  panelMode: PanelMode = 'none';
  selectedSnapshot: InventorySnapshot | null = null;
  loadingDetail = false;

  // New-snapshot form
  newDate    = new Date().toISOString().split('T')[0];
  newPeriod: SnapshotPeriod = 'MORNING';
  rows: QtyRow[] = [];
  newNotes   = '';
  saving     = false;
  saveError  = '';

  // Edit form
  editRows: QtyRow[] = [];
  editNotes  = '';
  editReason = '';
  editing    = false;
  editError  = '';

  ngOnInit() {
    this.productSvc.getAll().subscribe({
      next: (products) => {
        this.products = products
          .filter(p => p.active && (p.type === 'CONE' || p.type === 'CUP'))
          .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
        this.loadHistory();
      },
    });
  }

  loadHistory() {
    this.loadingHistory = true;
    this.inventorySvc.getAll().subscribe({
      next: (list) => { this.history = list; this.loadingHistory = false; },
      error: () => { this.loadingHistory = false; },
    });
  }

  periodLabel(p: SnapshotPeriod) { return p === 'MORNING' ? 'Mañana' : 'Noche'; }

  openView(row: InventorySnapshotSummary) {
    this.panelMode     = 'view';
    this.loadingDetail = true;
    this.selectedSnapshot = null;
    this.inventorySvc.getOne(row.id).subscribe({
      next: (s) => { this.selectedSnapshot = s; this.loadingDetail = false; },
      error: () => { this.loadingDetail = false; },
    });
  }

  closePanel() {
    this.panelMode = 'none';
    this.selectedSnapshot = null;
    this.saveError = '';
    this.editError = '';
  }

  openNew() {
    this.panelMode = 'new';
    this.newDate   = new Date().toISOString().split('T')[0];
    this.newPeriod = 'MORNING';
    this.newNotes  = '';
    this.saveError = '';
    this.buildRows(null);
  }

  private buildRows(snapshot: InventorySnapshot | null) {
    this.rows = [
      ...this.products.map(p => ({
        productId: p.id,
        display:   p.name,
        qty: Number(snapshot?.lines.find(l => l.productId === p.id)?.quantity ?? 0),
      })),
      {
        label:   WATER_LABEL,
        display: WATER_LABEL,
        qty: Number(snapshot?.lines.find(l => l.label === WATER_LABEL)?.quantity ?? 0),
      },
    ];
  }

  inc(row: QtyRow, step: number) { row.qty = Math.round((row.qty + step) * 10) / 10; }
  dec(row: QtyRow, step: number) { row.qty = Math.max(0, Math.round((row.qty - step) * 10) / 10); }

  saveNew() {
    this.saving    = true;
    this.saveError = '';
    const lines: InventoryLinePayload[] = this.rows.map(r => ({
      productId: r.productId,
      label:     r.label,
      quantity:  r.qty,
    }));
    this.inventorySvc.upsert({
      period: this.newPeriod,
      date:   this.newDate,
      lines,
      notes:  this.newNotes || undefined,
    }).subscribe({
      next: () => { this.saving = false; this.closePanel(); this.loadHistory(); },
      error: (e) => { this.saving = false; this.saveError = e?.error?.message ?? 'Error al guardar'; },
    });
  }

  startEdit() {
    if (!this.selectedSnapshot) return;
    this.editRows = [
      ...this.products.map(p => ({
        productId: p.id,
        display:   p.name,
        qty: Number(this.selectedSnapshot!.lines.find(l => l.productId === p.id)?.quantity ?? 0),
      })),
      {
        label:   WATER_LABEL,
        display: WATER_LABEL,
        qty: Number(this.selectedSnapshot!.lines.find(l => l.label === WATER_LABEL)?.quantity ?? 0),
      },
    ];
    this.editNotes  = this.selectedSnapshot.notes ?? '';
    this.editReason = '';
    this.editError  = '';
    this.panelMode  = 'edit';
  }

  cancelEdit() { this.panelMode = 'view'; }

  saveEdit() {
    if (!this.selectedSnapshot) return;
    this.editing   = true;
    this.editError = '';
    const lines: InventoryLinePayload[] = this.editRows.map(r => ({
      productId: r.productId,
      label:     r.label,
      quantity:  r.qty,
    }));
    this.inventorySvc.update(this.selectedSnapshot.id, {
      lines,
      notes:  this.editNotes  || undefined,
      reason: this.editReason || undefined,
    }).subscribe({
      next: (s) => {
        this.editing          = false;
        this.selectedSnapshot = s;
        this.panelMode        = 'view';
        this.loadHistory();
      },
      error: (e) => { this.editing = false; this.editError = e?.error?.message ?? 'Error al guardar'; },
    });
  }

  lineName(line: { product: { name: string } | null; label: string | null }): string {
    return line.product?.name ?? line.label ?? '—';
  }

  formatQty(n: number | string) { return Number(n).toFixed(1); }
}
