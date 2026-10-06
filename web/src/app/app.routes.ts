import { Routes } from '@angular/router';
import { staffGuard } from './core/auth';
import { pagesResolver, productResolver, productsResolver, shopContextResolver } from './shop/resolvers';

// Titles are translation keys (src/i18n), shown by core/title.ts.
export const routes: Routes = [
  {
    path: 'admin/login',
    title: 'titles.signIn',
    loadComponent: () => import('./admin/login/login').then((m) => m.Login),
  },
  {
    path: 'admin',
    canActivate: [staffGuard],
    loadComponent: () => import('./admin/shell/admin-shell').then((m) => m.AdminShell),
    children: [
      {
        path: '',
        title: 'titles.today',
        loadComponent: () => import('./admin/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'products',
        title: 'titles.products',
        loadComponent: () => import('./admin/products/product-list').then((m) => m.ProductList),
      },
      {
        // A new design is added with its stock, in one form.
        path: 'products/new',
        redirectTo: '/admin/stock/add',
      },
      {
        path: 'products/:id',
        title: 'titles.design',
        loadComponent: () => import('./admin/products/product-editor').then((m) => m.ProductEditor),
      },
      {
        path: 'scan',
        title: 'titles.scan',
        loadComponent: () => import('./admin/scan/scan').then((m) => m.Scan),
      },
      {
        path: 'labels',
        title: 'titles.labels',
        loadComponent: () => import('./admin/labels/labels').then((m) => m.Labels),
      },
      {
        path: 'lists',
        title: 'titles.lists',
        loadComponent: () => import('./admin/lists/lists').then((m) => m.Lists),
      },
      {
        path: 'stock',
        title: 'titles.stock',
        loadComponent: () => import('./admin/stock/stock-overview').then((m) => m.StockOverview),
      },
      {
        path: 'stock/add',
        title: 'titles.addStock',
        loadComponent: () => import('./admin/stock/add-item').then((m) => m.AddItem),
      },
      {
        path: 'stock/purchases/:id/add',
        title: 'titles.addItem',
        loadComponent: () => import('./admin/stock/add-item').then((m) => m.AddItem),
      },
      {
        path: 'stock/purchases',
        title: 'titles.trips',
        loadComponent: () => import('./admin/stock/purchase-list').then((m) => m.PurchaseList),
      },
      {
        path: 'stock/purchases/new',
        title: 'titles.newTrip',
        loadComponent: () => import('./admin/stock/purchase-editor').then((m) => m.PurchaseEditor),
      },
      {
        path: 'stock/purchases/:id',
        title: 'titles.trip',
        loadComponent: () => import('./admin/stock/purchase-editor').then((m) => m.PurchaseEditor),
      },
      {
        path: 'orders',
        title: 'titles.orders',
        loadComponent: () => import('./admin/orders/order-list').then((m) => m.OrderList),
      },
      {
        path: 'orders/new',
        title: 'titles.newOrder',
        loadComponent: () => import('./admin/orders/order-editor').then((m) => m.OrderEditor),
      },
      {
        path: 'orders/:id',
        title: 'titles.adminOrder',
        loadComponent: () => import('./admin/orders/order-detail').then((m) => m.OrderDetail),
      },
      {
        path: 'orders/:id/pack',
        title: 'titles.pack',
        loadComponent: () => import('./admin/orders/order-pack').then((m) => m.OrderPack),
      },
      {
        path: 'orders/:id/items',
        title: 'titles.changeItems',
        loadComponent: () => import('./admin/orders/order-editor').then((m) => m.OrderEditor),
      },
      {
        path: 'orders/:id/return',
        title: 'titles.return',
        loadComponent: () => import('./admin/orders/order-return').then((m) => m.OrderReturn),
      },
      {
        path: 'customers',
        title: 'titles.customers',
        loadComponent: () => import('./admin/customers/customer-list').then((m) => m.CustomerList),
      },
      {
        path: 'customers/:id',
        title: 'titles.customer',
        loadComponent: () => import('./admin/customers/customer-detail').then((m) => m.CustomerDetail),
      },
      {
        path: 'reports',
        title: 'titles.sales',
        loadComponent: () => import('./admin/reports/sales-report').then((m) => m.SalesReport),
      },
      {
        path: 'reports/owed',
        title: 'titles.owed',
        loadComponent: () => import('./admin/reports/owed-report').then((m) => m.OwedReport),
      },
      {
        path: 'reports/stock',
        title: 'titles.stockValue',
        loadComponent: () => import('./admin/reports/stock-report').then((m) => m.StockReport),
      },
      {
        path: 'reports/buying',
        title: 'titles.buying',
        loadComponent: () => import('./admin/reports/buying-report').then((m) => m.BuyingReport),
      },
      {
        path: 'settings',
        title: 'titles.settings',
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
        title: 'titles.shop',
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
        title: 'titles.bag',
        loadComponent: () => import('./shop/bag-page/bag-page').then((m) => m.BagPage),
      },
      {
        path: 'checkout',
        title: 'titles.checkout',
        loadComponent: () => import('./shop/checkout/checkout').then((m) => m.Checkout),
      },
      {
        path: 'order',
        title: 'titles.track',
        loadComponent: () => import('./shop/order/order-page').then((m) => m.OrderPage),
      },
      {
        path: 'order/:number',
        title: 'titles.order',
        loadComponent: () => import('./shop/order/order-page').then((m) => m.OrderPage),
      },
      {
        path: 'about',
        title: 'titles.about',
        loadComponent: () => import('./shop/info/info-pages').then((m) => m.AboutPage),
        resolve: { pages: pagesResolver },
      },
      {
        path: 'delivery',
        title: 'titles.delivery',
        loadComponent: () => import('./shop/info/info-pages').then((m) => m.DeliveryPage),
        resolve: { pages: pagesResolver },
      },
      {
        path: '**',
        title: 'titles.notFound',
        loadComponent: () => import('./shop/info/info-pages').then((m) => m.NotFoundPage),
      },
    ],
  },
];
