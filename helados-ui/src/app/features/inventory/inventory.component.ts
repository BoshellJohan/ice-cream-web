import { Component, OnInit, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { FlavorService } from '../../core/services/flavor.service';
import { ToppingService } from '../../core/services/topping.service';
import { InventoryApiService } from '../../core/services/inventory.service';
import { Flavor } from '../../core/models/flavor.model';
import { Topping } from '../../core/models/topping.model';
import { DeltaLine, InventorySnapshot, SnapshotPeriod } from '../../core/models/inventory.model';

interface QtyRow { id: string; label: string; qty: number; }

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './inventory.component.html',
})
export class InventoryComponent implements OnInit {
  private flavorSvc    = inject(FlavorService);
  private toppingSvc   = inject(ToppingService);
  private inventorySvc = inject(InventoryApiService);

  selectedDate   = new Date().toISOString().split('T')[0];
  selectedPeriod: SnapshotPeriod = 'MORNING';

  flavors:  Flavor[]  = [];
  toppings: Topping[] = [];

  flavorQties:  QtyRow[] = [];
  toppingQties: QtyRow[] = [];

  notes       = '';
  saving      = false;
  saveSuccess = false;
  saveError   = '';

  morningSnapshot: InventorySnapshot | null = null;
  nightSnapshot:   InventorySnapshot | null = null;
  delta: DeltaLine[] = [];

  loadingCatalog   = true;
  loadingSnapshots = false;

  ngOnInit() {
    forkJoin({
      flavors:  this.flavorSvc.getAll(),
      toppings: this.toppingSvc.getAll(),
    }).subscribe({
      next: ({ flavors, toppings }) => {
        this.flavors  = flavors.filter(f => f.active);
        this.toppings = toppings.filter(t => t.active);
        this.loadingCatalog = false;
        this.initForm();
        this.loadSnapshots();
      },
    });
  }

  private initForm(snapshot?: InventorySnapshot | null) {
    const getFlavorQty  = (id: string) => snapshot?.lines.find(l => l.flavorId  === id)?.quantity ?? 0;
    const getToppingQty = (id: string) => snapshot?.lines.find(l => l.toppingId === id)?.quantity ?? 0;

    this.flavorQties  = this.flavors.map(f  => ({ id: f.id, label: f.name,  qty: Number(getFlavorQty(f.id))   }));
    this.toppingQties = this.toppings.map(t => ({ id: t.id, label: t.name,  qty: Number(getToppingQty(t.id))  }));
    this.notes = snapshot?.notes ?? '';
  }

  selectPeriod(period: SnapshotPeriod) {
    this.selectedPeriod = period;
    const snapshot = period === 'MORNING' ? this.morningSnapshot : this.nightSnapshot;
    this.initForm(snapshot);
  }

  loadSnapshots() {
    this.loadingSnapshots = true;
    this.inventorySvc.getSnapshots(this.selectedDate).subscribe({
      next: ({ morning, night }) => {
        this.morningSnapshot  = morning;
        this.nightSnapshot    = night;
        this.loadingSnapshots = false;
        const snapshot = this.selectedPeriod === 'MORNING' ? morning : night;
        this.initForm(snapshot);
        this.buildDelta();
      },
      error: () => { this.loadingSnapshots = false; },
    });
  }

  onDateChange() {
    this.saveSuccess = false;
    this.saveError   = '';
    this.loadSnapshots();
  }

  private buildDelta() {
    if (!this.morningSnapshot || !this.nightSnapshot) {
      this.delta = [];
      return;
    }

    const lines: DeltaLine[] = [];

    for (const flavor of this.flavors) {
      const m = Number(this.morningSnapshot.lines.find(l => l.flavorId  === flavor.id)?.quantity ?? 0);
      const n = Number(this.nightSnapshot.lines.find(l   => l.flavorId  === flavor.id)?.quantity ?? 0);
      if (m > 0 || n > 0) lines.push({ label: flavor.name,  morning: m, night: n, consumed: m - n });
    }

    for (const topping of this.toppings) {
      const m = Number(this.morningSnapshot.lines.find(l => l.toppingId === topping.id)?.quantity ?? 0);
      const n = Number(this.nightSnapshot.lines.find(l   => l.toppingId === topping.id)?.quantity ?? 0);
      if (m > 0 || n > 0) lines.push({ label: topping.name, morning: m, night: n, consumed: m - n });
    }

    this.delta = lines;
  }

  inc(row: QtyRow, step: number) { row.qty = Math.round((row.qty + step) * 10) / 10; }
  dec(row: QtyRow, step: number) { row.qty = Math.max(0, Math.round((row.qty - step) * 10) / 10); }

  save() {
    this.saving      = true;
    this.saveSuccess = false;
    this.saveError   = '';

    const payload = {
      period: this.selectedPeriod,
      date:   this.selectedDate,
      notes:  this.notes || undefined,
      lines: [
        ...this.flavorQties.map(r  => ({ flavorId:  r.id, quantity: r.qty })),
        ...this.toppingQties.map(r => ({ toppingId: r.id, quantity: r.qty })),
      ],
    };

    this.inventorySvc.upsert(payload).subscribe({
      next: (snapshot) => {
        this.saving      = false;
        this.saveSuccess = true;
        if (this.selectedPeriod === 'MORNING') this.morningSnapshot = snapshot;
        else                                   this.nightSnapshot   = snapshot;
        this.buildDelta();
      },
      error: (e) => {
        this.saving    = false;
        this.saveError = e?.error?.message ?? 'Error al guardar inventario';
      },
    });
  }

  formatQty(n: number) { return Number(n).toFixed(1); }
}
