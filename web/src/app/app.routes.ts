import { Routes } from '@angular/router';
import { staffGuard } from './core/auth';
import { productResolver, productsResolver, shopContextResolver } from './shop/resolvers';

export const routes: Routes = [
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
        loadComponent: () => import('./admin/orders/order-list').then((m) => m.OrderList),
      },
      {
        path: 'orders/:id',
        title: 'Order · Hey Chika',
        loadComponent: () => import('./admin/orders/order-detail').then((m) => m.OrderDetail),
      },
      {
        path: 'settings',
        title: 'Settings · Hey Chika',
        loadComponent: () => import('./admin/settings/settings').then((m) => m.Settings),
      },
    ],
  },

  // The shop. Last, so its catch-all doesn't swallow /admin.
  {
    path: '',
    loadComponent: () => import('./shop/shell/shop-shell').then((m) => m.ShopShell),
    resolve: { context: shopContextResolver },
    children: [
      {
        path: '',
        title: 'Hey Chika',
        loadComponent: () => import('./shop/home/home').then((m) => m.Home),
        resolve: { products: productsResolver },
      },
      {
        // The product page sets its own title, from the product.
        path: 'p/:slug',
        loadComponent: () => import('./shop/product/product-page').then((m) => m.ProductPage),
        resolve: { product: productResolver },
      },
      {
        path: 'bag',
        title: 'Your bag · Hey Chika',
        loadComponent: () => import('./shop/bag-page/bag-page').then((m) => m.BagPage),
      },
      {
        path: 'checkout',
        title: 'Checkout · Hey Chika',
        loadComponent: () => import('./shop/checkout/checkout').then((m) => m.Checkout),
      },
      {
        path: 'order',
        title: 'Track an order · Hey Chika',
        loadComponent: () => import('./shop/order/order-page').then((m) => m.OrderPage),
      },
      {
        path: 'order/:number',
        title: 'Your order · Hey Chika',
        loadComponent: () => import('./shop/order/order-page').then((m) => m.OrderPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
