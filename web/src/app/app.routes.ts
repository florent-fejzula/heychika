import { Routes } from '@angular/router';
import { staffGuard } from './core/auth';

export const routes: Routes = [
  {
    path: '',
    title: 'Hey Chika',
    loadComponent: () => import('./shop/landing/landing').then((m) => m.Landing),
  },
  {
    path: 'admin/login',
    title: 'Sign in · Hey Chika',
    loadComponent: () => import('./admin/login/login').then((m) => m.Login),
  },
  {
    path: 'admin',
    canActivate: [staffGuard],
    loadComponent: () => import('./admin/shell/admin-shell').then((m) => m.AdminShell),
    children: [
      {
        path: '',
        title: 'Today · Hey Chika',
        loadComponent: () => import('./admin/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'products',
        title: 'Products · Hey Chika',
        loadComponent: () => import('./admin/products/product-list').then((m) => m.ProductList),
      },
      {
        path: 'products/new',
        title: 'New design · Hey Chika',
        loadComponent: () => import('./admin/products/product-editor').then((m) => m.ProductEditor),
      },
      {
        path: 'products/:id',
        title: 'Design · Hey Chika',
        loadComponent: () => import('./admin/products/product-editor').then((m) => m.ProductEditor),
      },
      {
        path: 'scan',
        title: 'Scan · Hey Chika',
        loadComponent: () => import('./admin/scan/scan').then((m) => m.Scan),
      },
      {
        path: 'labels',
        title: 'Labels · Hey Chika',
        loadComponent: () => import('./admin/labels/labels').then((m) => m.Labels),
      },
      {
        path: 'lists',
        title: 'Categories, colours & sizes · Hey Chika',
        loadComponent: () => import('./admin/lists/lists').then((m) => m.Lists),
      },
      {
        path: 'stock',
        title: 'Stock · Hey Chika',
        loadComponent: () => import('./admin/stock/stock-overview').then((m) => m.StockOverview),
      },
      {
        path: 'stock/purchases',
        title: 'Buying trips · Hey Chika',
        loadComponent: () => import('./admin/stock/purchase-list').then((m) => m.PurchaseList),
      },
      {
        path: 'stock/purchases/new',
        title: 'New buying trip · Hey Chika',
        loadComponent: () => import('./admin/stock/purchase-editor').then((m) => m.PurchaseEditor),
      },
      {
        path: 'stock/purchases/:id',
        title: 'Buying trip · Hey Chika',
        loadComponent: () => import('./admin/stock/purchase-editor').then((m) => m.PurchaseEditor),
      },
      {
        path: 'orders',
        title: 'Orders · Hey Chika',
        loadComponent: () => import('./admin/coming-soon/coming-soon').then((m) => m.ComingSoon),
        data: {
          heading: 'Orders',
          phase: 7,
          blurb: 'Orders customers place themselves on the shop, ready to pack. Scan to dispatch, mark the cash collected.',
        },
      },
      {
        path: 'settings',
        title: 'Settings · Hey Chika',
        loadComponent: () => import('./admin/settings/settings').then((m) => m.Settings),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
