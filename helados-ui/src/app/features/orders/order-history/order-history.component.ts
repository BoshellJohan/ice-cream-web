import { Component, OnInit, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OrderService } from '../../../core/services/order.service';
import { Order, CancelReason, CANCEL_REASON_LABELS } from '../../../core/models/order.model';

@Component({
  selector: 'app-order-history',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './order-history.component.html',
})
export class OrderHistoryComponent implements OnInit {
  private orderSvc = inject(OrderService);

  orders: Order[] = [];
  loading = false;
  expandedId: string | null = null;

  fromDate = '';
  toDate   = '';

  cancellingId: string | null = null;   // pedido con el panel de motivos abierto
  cancelError: string | null = null;
  submitting = false;

  readonly reasons = Object.entries(CANCEL_REASON_LABELS) as [CancelReason, string][];

  ngOnInit() {
    const today = new Date().toISOString().split('T')[0];
    this.fromDate = today;
    this.toDate   = today;
    this.load();
  }

  load() {
    this.loading = true;
    this.orderSvc.getAll(this.fromDate || undefined, this.toDate || undefined).subscribe({
      next:  (orders) => { this.orders = orders; this.loading = false; },
      error: ()       => { this.loading = false; },
    });
  }

  setToday() {
    const today = new Date().toISOString().split('T')[0];
    this.fromDate = today;
    this.toDate   = today;
    this.load();
  }

  toggleExpand(id: string) {
    this.expandedId = this.expandedId === id ? null : id;
  }

  openCancel(order: Order, event: Event) {
    event.stopPropagation();          // no expandir/colapsar la fila
    this.cancellingId = order.id;
    this.cancelError  = null;
  }

  closeCancel() {
    this.cancellingId = null;
    this.cancelError  = null;
  }

  confirmCancel(orderId: string, reason: CancelReason) {
    this.submitting = true;
    this.cancelError = null;
    this.orderSvc.cancel(orderId, reason).subscribe({
      next: () => {
        this.submitting  = false;
        this.cancellingId = null;
        this.load();
      },
      error: (err) => {
        this.submitting = false;
        this.cancelError =
          err?.error?.message ?? 'No se pudo anular el pedido. Inténtalo de nuevo.';
      },
    });
  }

  reasonLabel(reason: CancelReason | null): string {
    return reason ? CANCEL_REASON_LABELS[reason] : '';
  }

  formatPrice(n: number | string) { return `$${Number(n).toFixed(2)}`; }

  itemSummary(order: Order): string {
    return order.items.map(i => i.flavor ? `${i.product.name} (${i.flavor.name})` : i.product.name).join(', ');
  }
}
