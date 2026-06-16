import { Component, OnInit, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProductService } from '../../core/services/product.service';
import { InventoryApiService } from '../../core/services/inventory.service';
import { Product } from '../../core/models/product.model';
import {
  InventorySnapshot, InventorySnapshotSummary,
  InventoryLine, InventoryLinePayload, SnapshotPeriod,
} from '../../core/models/inventory.model';

interface PackagingRow {
  productType: 'CONE' | 'CONTAINER';
  productSize: string;
  display: string;
  qty: number;
}

interface BeverageRow {
  productId: string;
  display: string;
  qty: number;
}

const CONE_SIZES      = ['SMALL', 'MEDIUM', 'LARGE'];
const CONTAINER_SIZES = ['OZ4', 'OZ5', 'OZ6', 'OZ7', 'OZ8'];

const SIZE_LABELS: Record<string, string> = {
  SMALL: 'Pequeño', MEDIUM: 'Mediano', LARGE: 'Grande',
  OZ4: '4 oz', OZ5: '5 oz', OZ6: '6 oz', OZ7: '7 oz', OZ8: '8 oz',
};

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

  // New/edit form rows (shared between new and edit panels)
  coneRows:      PackagingRow[] = [];
  containerRows: PackagingRow[] = [];
  beverageRows:  BeverageRow[]  = [];

  newDate    = new Date().toISOString().split('T')[0];
  newPeriod: SnapshotPeriod = 'MORNING';
  newNotes   = '';
  saving     = false;
  saveError  = '';

  editNotes  = '';
  editReason = '';
  editing    = false;
  editError  = '';

  ngOnInit() {
    this.productSvc.getAll().subscribe({
      next: (products) => {
        this.products = products.filter(p => p.active);
        this.loadHistory();
      },
    });
  }

  loadHistory() {
    this.loadingHistory = true;
    this.inventorySvc.getAll().subscribe({
      next:  (list) => { this.history = list; this.loadingHistory = false; },
      error: ()     => { this.loadingHistory = false; },
    });
  }

  periodLabel(p: SnapshotPeriod) { return p === 'MORNING' ? 'Mañana' : 'Noche'; }

  openView(row: InventorySnapshotSummary) {
    this.panelMode     = 'view';
    this.loadingDetail = true;
    this.selectedSnapshot = null;
    this.inventorySvc.getOne(row.id).subscribe({
      next:  (s) => { this.selectedSnapshot = s; this.loadingDetail = false; },
      error: ()  => { this.loadingDetail = false; },
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
    const lines = snapshot?.lines ?? [];
    const bevProds = this.products.filter(p => p.type === 'BEVERAGE');

    this.coneRows = CONE_SIZES.map(size => ({
      productType: 'CONE' as const,
      productSize: size,
      display: SIZE_LABELS[size] ?? size,
      qty: Number(lines.find(l => l.productType === 'CONE' && l.productSize === size)?.quantity ?? 0),
    }));

    this.containerRows = CONTAINER_SIZES.map(size => ({
      productType: 'CONTAINER' as const,
      productSize: size,
      display: SIZE_LABELS[size] ?? size,
      qty: Number(lines.find(l => l.productType === 'CONTAINER' && l.productSize === size)?.quantity ?? 0),
    }));

    this.beverageRows = bevProds.map(p => ({
      productId: p.id,
      display:   p.name,
      qty: Number(lines.find(l => l.productId === p.id)?.quantity ?? 0),
    }));
  }

  inc(row: PackagingRow | BeverageRow, step: number) {
    row.qty = Math.round((row.qty + step) * 10) / 10;
  }

  dec(row: PackagingRow | BeverageRow, step: number) {
    row.qty = Math.max(0, Math.round((row.qty - step) * 10) / 10);
  }

  private buildLines(): InventoryLinePayload[] {
    return [
      ...this.coneRows.map(r => ({ productType: r.productType, productSize: r.productSize, quantity: r.qty })),
      ...this.containerRows.map(r => ({ productType: r.productType, productSize: r.productSize, quantity: r.qty })),
      ...this.beverageRows.map(r => ({ productId: r.productId, quantity: r.qty })),
    ];
  }

  saveNew() {
    this.saving    = true;
    this.saveError = '';
    this.inventorySvc.upsert({
      period: this.newPeriod,
      date:   this.newDate,
      lines:  this.buildLines(),
      notes:  this.newNotes || undefined,
    }).subscribe({
      next:  () => { this.saving = false; this.closePanel(); this.loadHistory(); },
      error: (e) => { this.saving = false; this.saveError = e?.error?.message ?? 'Error al guardar'; },
    });
  }

  startEdit() {
    if (!this.selectedSnapshot) return;
    this.buildRows(this.selectedSnapshot);
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
    this.inventorySvc.update(this.selectedSnapshot.id, {
      lines:  this.buildLines(),
      notes:  this.editNotes  || undefined,
      reason: this.editReason || undefined,
    }).subscribe({
      next:  (s) => { this.editing = false; this.selectedSnapshot = s; this.panelMode = 'view'; this.loadHistory(); },
      error: (e) => { this.editing = false; this.editError = e?.error?.message ?? 'Error al guardar'; },
    });
  }

  // Grouped view getters
  get viewConeLines(): InventoryLine[] {
    return this.selectedSnapshot?.lines.filter(l => l.productType === 'CONE') ?? [];
  }
  get viewContainerLines(): InventoryLine[] {
    return this.selectedSnapshot?.lines.filter(l => l.productType === 'CONTAINER') ?? [];
  }
  get viewBeverageLines(): InventoryLine[] {
    return this.selectedSnapshot?.lines.filter(l => l.productId && !l.productType) ?? [];
  }
  get viewLabelLines(): InventoryLine[] {
    return this.selectedSnapshot?.lines.filter(l => l.label) ?? [];
  }

  remainingClass(remaining: number | undefined): string {
    if (remaining === undefined) return '';
    if (remaining === 0)  return 'text-red-400';
    if (remaining <= 3)   return 'text-amber-400';
    return 'text-green-400';
  }

  sizeLabelFor(size: string | null): string {
    return size ? (SIZE_LABELS[size] ?? size) : '—';
  }

  formatQty(n: number | string) { return Number(n).toFixed(1); }
}
