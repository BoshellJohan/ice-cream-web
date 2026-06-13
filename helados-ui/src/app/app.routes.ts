import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';

export const routes: Routes = [
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'orders',
    canActivate: [authGuard],
    children: [
      {
        path: 'new',
        loadComponent: () =>
          import('./features/orders/new-order/new-order.component').then((m) => m.NewOrderComponent),
      },
      {
        path: 'history',
        loadComponent: () =>
          import('./features/orders/order-history/order-history.component').then((m) => m.OrderHistoryComponent),
      },
    ],
  },
  {
    path: 'dashboard',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./features/analytics/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'inventory',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./features/inventory/inventory.component').then((m) => m.InventoryComponent),
  },
  {
    path: 'catalog',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./features/catalog/catalog.component').then((m) => m.CatalogComponent),
  },
  {
    path: 'coupons',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./features/coupons/coupons.component').then((m) => m.CouponsComponent),
  },
  {
    path: 'users',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./features/users/users.component').then((m) => m.UsersComponent),
  },
  { path: '**', redirectTo: '/login' },
];
