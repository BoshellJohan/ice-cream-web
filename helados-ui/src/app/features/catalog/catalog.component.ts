import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { ProductService } from '../../core/services/product.service';
import { FlavorService } from '../../core/services/flavor.service';
import { ToppingService } from '../../core/services/topping.service';
import { ImageUploadComponent } from '../../shared/components/image-upload/image-upload.component';
import { Product, ProductType, ProductSize } from '../../core/models/product.model';
import { Flavor } from '../../core/models/flavor.model';
import { Topping } from '../../core/models/topping.model';

type Tab = 'products' | 'flavors' | 'toppings';
type CatalogItem = (Product | Flavor | Topping) & { basePrice?: number; priceModifier?: number; unitPrice?: number };

@Component({
  selector: 'app-catalog',
  standalone: true,
  imports: [CommonModule, FormsModule, ImageUploadComponent],
  templateUrl: './catalog.component.html',
})
export class CatalogComponent implements OnInit {
  private productSvc = inject(ProductService);
  private flavorSvc = inject(FlavorService);
  private toppingSvc = inject(ToppingService);

  activeTab: Tab = 'products';
  products: Product[] = [];
  flavors: Flavor[] = [];
  toppings: Topping[] = [];
  loading = false;
  saving = false;
  error = '';

  showForm = false;
  editingId: string | null = null;

  form = {
    name: '',
    basePrice: 0,
    priceModifier: 0,
    unitPrice: 0,
    type: 'CONE' as ProductType,
    size: 'SMALL' as ProductSize,
    imageUrl: '',
    directSale: false,
  };

  productTypes: ProductType[] = ['CONE', 'CONTAINER', 'CUP', 'BOWL'];
  productSizes: ProductSize[] = ['SMALL', 'MEDIUM', 'LARGE'];

  readonly tabs = [
    { key: 'products' as Tab, label: 'Productos' },
    { key: 'flavors' as Tab, label: 'Sabores' },
    { key: 'toppings' as Tab, label: 'Toppings' },
  ];

  ngOnInit() { this.loadAll(); }

  loadAll() {
    this.loading = true;
    this.productSvc.getAll().subscribe({ next: p => this.products = p, error: () => {} });
    this.flavorSvc.getAll().subscribe({ next: f => this.flavors = f, error: () => {} });
    this.toppingSvc.getAll().subscribe({ next: t => { this.toppings = t; this.loading = false; }, error: () => { this.loading = false; } });
  }

  get currentItems(): CatalogItem[] {
    if (this.activeTab === 'products') return this.products;
    if (this.activeTab === 'flavors') return this.flavors;
    return this.toppings;
  }

  priceLabel(item: CatalogItem): string {
    const price = item.basePrice ?? item.priceModifier ?? item.unitPrice ?? 0;
    return `$${Number(price).toFixed(2)}`;
  }

  openCreate() {
    this.editingId = null;
    this.form = { name: '', basePrice: 0, priceModifier: 0, unitPrice: 0, type: 'CONE', size: 'SMALL', imageUrl: '', directSale: false };
    this.error = '';
    this.showForm = true;
  }

  openEdit(item: CatalogItem) {
    this.editingId = item.id;
    this.form = {
      name: item.name,
      basePrice: Number((item as Product).basePrice ?? 0),
      priceModifier: Number((item as Flavor).priceModifier ?? 0),
      unitPrice: Number((item as Topping).unitPrice ?? 0),
      type: (item as Product).type ?? 'CONE',
      size: (item as Product).size ?? 'SMALL',
      imageUrl: item.imageUrl ?? '',
      directSale: (item as Product).directSale ?? false,
    };
    this.error = '';
    this.showForm = true;
  }

  onImageUploaded(url: string) { this.form.imageUrl = url; }

  save() {
    this.saving = true;
    this.error = '';

    const obs: Observable<unknown> = this.activeTab === 'products'
      ? (this.editingId
          ? this.productSvc.update(this.editingId, { name: this.form.name, type: this.form.type, size: this.form.size, basePrice: this.form.basePrice, imageUrl: this.form.imageUrl || undefined, directSale: this.form.directSale })
          : this.productSvc.create({ name: this.form.name, type: this.form.type, size: this.form.size, basePrice: this.form.basePrice, imageUrl: this.form.imageUrl || undefined, directSale: this.form.directSale }))
      : this.activeTab === 'flavors'
        ? (this.editingId
            ? this.flavorSvc.update(this.editingId, { name: this.form.name, priceModifier: this.form.priceModifier, imageUrl: this.form.imageUrl || undefined })
            : this.flavorSvc.create({ name: this.form.name, priceModifier: this.form.priceModifier, imageUrl: this.form.imageUrl || undefined }))
        : (this.editingId
            ? this.toppingSvc.update(this.editingId, { name: this.form.name, unitPrice: this.form.unitPrice, imageUrl: this.form.imageUrl || undefined })
            : this.toppingSvc.create({ name: this.form.name, unitPrice: this.form.unitPrice, imageUrl: this.form.imageUrl || undefined }));

    obs.subscribe({
      next: () => { this.saving = false; this.showForm = false; this.loadAll(); },
      error: (err) => { this.saving = false; this.error = err?.error?.message ?? 'Error al guardar'; },
    });
  }

  toggleActive(item: CatalogItem) {
    const obs: Observable<unknown> = this.activeTab === 'products'
      ? this.productSvc.toggleActive(item.id)
      : this.activeTab === 'flavors'
        ? this.flavorSvc.toggleActive(item.id)
        : this.toppingSvc.toggleActive(item.id);
    obs.subscribe({ next: () => this.loadAll(), error: () => {} });
  }
}
