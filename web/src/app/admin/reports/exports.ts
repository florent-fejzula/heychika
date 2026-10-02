import { COUNTRY_NAME } from '../../core/money';
import {
  BuyingReport,
  CHANNEL_LABEL,
  Group,
  OwedReport,
  Period,
  SalesReport,
  StockGroup,
  StockReport,
  localDate,
  periodLabel,
  periodSlug,
} from '../../core/reports';
import { Column, Sheet } from '../../core/xlsx';

// What each report looks like in Excel: one sheet per table on the screen, plus
// the rows underneath, so anything can be filtered or summed further.

export function fileName(report: string, period?: Period, today = new Date()): string {
  return `hey-chika-${report}-${period ? periodSlug(period) : localDate(today)}.xlsx`;
}

const margin = (profit: number, sales: number) => (sales > 0 ? profit / sales : null);

// ---------------------------------------------------------------------------
// Sales

export function salesSheets(r: SalesReport, period: Period): Sheet[] {
  const groupSheet = (name: string, label: string, groups: Group[]): Sheet => ({
    name,
    columns: [
      { header: label },
      { header: 'Orders', kind: 'int' },
      { header: 'Items', kind: 'int' },
      { header: 'Sales €', kind: 'money' },
      { header: 'Cost €', kind: 'money' },
      { header: 'Profit €', kind: 'money' },
      { header: 'Margin', kind: 'percent' },
    ],
    rows: groups.map((g) => [g.label, g.orders, g.items, g.sales, g.cost, g.profit, margin(g.profit, g.sales)]),
    totals: ['Total', r.orders, r.items, r.sales, r.cost, r.profit, r.margin],
  });

  return [
    {
      name: 'Summary',
      columns: [
        { header: 'Period' },
        { header: 'Orders', kind: 'int' },
        { header: 'Items', kind: 'int' },
        { header: 'Sales €', kind: 'money' },
        { header: 'Cost €', kind: 'money' },
        { header: 'Profit €', kind: 'money' },
        { header: 'Margin', kind: 'percent' },
        { header: 'Cash in €', kind: 'money' },
        { header: 'Refunds €', kind: 'money' },
        { header: 'Delivery fees €', kind: 'money' },
        { header: 'Cash in EUR', kind: 'money' },
        { header: 'Cash in MKD', kind: 'money' },
        { header: 'Cash in ALL', kind: 'money' },
      ],
      rows: [
        [
          periodLabel(period),
          r.orders,
          r.items,
          r.sales,
          r.cost,
          r.profit,
          r.margin,
          r.cashEur,
          r.refundsEur,
          r.deliveryEur,
          r.cash.EUR,
          r.cash.MKD,
          r.cash.ALL,
        ],
      ],
    },
    groupSheet('By design', 'Design', r.byDesign),
    groupSheet('By category', 'Category', r.byCategory),
    groupSheet('By country', 'Country', r.byCountry),
    groupSheet('Shop or DM', 'Where it was ordered', r.byChannel),
    groupSheet('By month', 'Month', r.byMonth),
    {
      name: 'Orders',
      columns: [
        { header: 'Paid on', kind: 'date' },
        { header: 'Order' },
        { header: 'Customer' },
        { header: 'Country' },
        { header: 'Ordered' },
        { header: 'Items', kind: 'int' },
        { header: 'Sales €', kind: 'money' },
        { header: 'Cost €', kind: 'money' },
        { header: 'Profit €', kind: 'money' },
        { header: 'Currency' },
        { header: 'Collected', kind: 'money' },
        { header: 'Refunded', kind: 'money' },
        { header: 'Collected €', kind: 'money' },
        { header: 'Refunded €', kind: 'money' },
        { header: 'Delivery fee €', kind: 'money' },
      ],
      rows: r.orderRows.map((o) => [
        o.paidOn,
        o.orderNumber,
        o.customer,
        COUNTRY_NAME[o.country],
        CHANNEL_LABEL[o.channel],
        o.items,
        o.sales,
        o.cost,
        o.profit,
        o.currency,
        o.collected,
        o.refunded,
        o.collectedEur,
        o.refundedEur,
        o.deliveryEur,
      ]),
    },
    {
      name: 'Items sold',
      columns: [
        { header: 'Paid on', kind: 'date' },
        { header: 'Order' },
        { header: 'Customer' },
        { header: 'Country' },
        { header: 'Ordered' },
        { header: 'Category' },
        { header: 'Design' },
        { header: 'Colour' },
        { header: 'Size' },
        { header: 'SKU' },
        { header: 'Qty', kind: 'int' },
        { header: 'Price each €', kind: 'money' },
        { header: 'Sales €', kind: 'money' },
        { header: 'Cost €', kind: 'money' },
        { header: 'Profit €', kind: 'money' },
      ],
      rows: r.lines.map((l) => [
        l.paidOn,
        l.orderNumber,
        l.customer,
        COUNTRY_NAME[l.country],
        CHANNEL_LABEL[l.channel],
        l.category,
        l.design,
        l.colour,
        l.size,
        l.sku,
        l.qty,
        l.priceEur,
        l.sales,
        l.costMissing ? null : l.cost,
        l.profit,
      ]),
      totals: ['Total', null, null, null, null, null, null, null, null, null, r.items, null, r.sales, r.cost, r.profit],
    },
  ];
}

// ---------------------------------------------------------------------------
// Money owed

export function owedSheets(r: OwedReport): Sheet[] {
  const owedColumns = (when: string): Column[] => [
    { header: 'Order' },
    { header: 'Customer' },
    { header: 'Phone' },
    { header: 'Town' },
    { header: 'Country' },
    { header: 'Courier' },
    { header: when, kind: 'date' },
    { header: 'Days', kind: 'int' },
    { header: 'Currency' },
    { header: 'Due', kind: 'money' },
    { header: 'Due €', kind: 'money' },
  ];
  const owedRows = (list: OwedReport['delivered']) =>
    list.map((o) => [o.orderNumber, o.customer, o.phone, o.city, COUNTRY_NAME[o.country], o.courier, o.since, o.days, o.currency, o.due, o.dueEur]);

  return [
    {
      name: 'Courier owes',
      columns: owedColumns('Delivered on'),
      rows: owedRows(r.delivered),
      totals: ['Total', null, null, null, null, null, null, null, null, null, r.deliveredEur],
    },
    {
      name: 'Out for delivery',
      columns: owedColumns('Sent on'),
      rows: owedRows(r.onTheWay),
      totals: ['Total', null, null, null, null, null, null, null, null, null, r.onTheWayEur],
    },
    {
      name: 'Coming back',
      columns: [
        { header: 'Order' },
        { header: 'Customer' },
        { header: 'Town' },
        { header: 'Country' },
        { header: 'Why' },
        { header: 'Since', kind: 'date' },
        { header: 'Days', kind: 'int' },
        { header: 'Design' },
        { header: 'Colour' },
        { header: 'Size' },
        { header: 'Qty', kind: 'int' },
      ],
      rows: r.comingBack.flatMap((c) =>
        c.items.map((i) => [
          c.orderNumber,
          c.customer,
          c.city,
          COUNTRY_NAME[c.country],
          c.why === 'not_delivered' ? 'Not delivered' : 'Handed back at the door',
          c.since,
          c.days,
          i.name,
          i.colour,
          i.size,
          i.qty,
        ]),
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Stock

export function stockSheets(r: StockReport): Sheet[] {
  const groupSheet = (name: string, label: string, groups: StockGroup[]): Sheet => ({
    name,
    columns: [
      { header: label },
      { header: 'Sizes', kind: 'int' },
      { header: 'On the shelf', kind: 'int' },
      { header: 'Available', kind: 'int' },
      { header: 'On the road', kind: 'int' },
      { header: 'Damaged', kind: 'int' },
      { header: 'Shelf at cost €', kind: 'money' },
      { header: 'Shelf at price €', kind: 'money' },
    ],
    rows: groups.map((g) => [g.label, g.skus, g.shelf, g.available, g.road, g.damaged, g.valueCost, g.valuePrice]),
    totals: ['Total', r.totals.skus, r.totals.shelf, r.totals.available, r.totals.road, r.totals.damaged, r.totals.valueCost, r.totals.valuePrice],
  });

  const t = r.totals;
  return [
    {
      name: 'Summary',
      columns: [
        { header: 'Sizes', kind: 'int' },
        { header: 'On the shelf', kind: 'int' },
        { header: 'Reserved', kind: 'int' },
        { header: 'Available', kind: 'int' },
        { header: 'On the road', kind: 'int' },
        { header: 'Damaged', kind: 'int' },
        { header: 'Shelf at cost €', kind: 'money' },
        { header: 'Shelf at price €', kind: 'money' },
        { header: 'On the road at cost €', kind: 'money' },
        { header: 'Damaged at cost €', kind: 'money' },
        { header: 'Sold out', kind: 'int' },
        { header: 'Running low', kind: 'int' },
      ],
      rows: [[t.skus, t.shelf, t.reserved, t.available, t.road, t.damaged, t.valueCost, t.valuePrice, t.roadCost, t.damagedCost, t.soldOut, t.low]],
    },
    groupSheet('By category', 'Category', r.byCategory),
    groupSheet('By design', 'Design', r.byDesign),
    {
      name: 'Every size',
      columns: [
        { header: 'Category' },
        { header: 'Design' },
        { header: 'Colour' },
        { header: 'Size' },
        { header: 'SKU' },
        { header: 'For sale' },
        { header: 'On the shelf', kind: 'int' },
        { header: 'Reserved', kind: 'int' },
        { header: 'Available', kind: 'int' },
        { header: 'On the road', kind: 'int' },
        { header: 'Damaged', kind: 'int' },
        { header: 'Low at', kind: 'int' },
        { header: 'Cost €', kind: 'money' },
        { header: 'Price €', kind: 'money' },
        { header: 'Shelf at cost €', kind: 'money' },
        { header: 'Shelf at price €', kind: 'money' },
      ],
      rows: r.lines.map((l) => [
        l.category,
        l.design,
        l.colour,
        l.size,
        l.sku,
        l.forSale ? 'Yes' : 'No',
        l.shelf,
        l.reserved,
        l.available,
        l.road,
        l.damaged,
        l.min || null,
        l.costEur,
        l.priceEur,
        l.valueCost,
        l.valuePrice,
      ]),
      totals: ['Total', null, null, null, null, null, t.shelf, t.reserved, t.available, t.road, t.damaged, null, null, null, t.valueCost, t.valuePrice],
    },
  ];
}

// ---------------------------------------------------------------------------
// Buying

export function buyingSheets(r: BuyingReport): Sheet[] {
  const t = r.totals;
  return [
    {
      name: 'Trips',
      columns: [
        { header: 'Date', kind: 'date' },
        { header: 'Trip' },
        { header: 'Supplier' },
        { header: 'Paid in' },
        { header: 'Items', kind: 'int' },
        { header: 'Goods €', kind: 'money' },
        { header: 'Trip costs €', kind: 'money' },
        { header: 'Total €', kind: 'money' },
        { header: 'Per item €', kind: 'money' },
      ],
      rows: r.trips.map((p) => [p.date, p.reference, p.supplier, p.currency, p.items, p.goodsEur, p.extraEur, p.totalEur, p.perItemEur]),
      totals: ['Total', null, null, null, t.items, t.goodsEur, t.extraEur, t.totalEur, t.items ? Math.round((t.totalEur / t.items) * 100) / 100 : null],
    },
    {
      name: 'By supplier',
      columns: [
        { header: 'Supplier' },
        { header: 'Trips', kind: 'int' },
        { header: 'Items', kind: 'int' },
        { header: 'Goods €', kind: 'money' },
        { header: 'Trip costs €', kind: 'money' },
        { header: 'Total €', kind: 'money' },
      ],
      rows: r.bySupplier.map((s) => [s.label, s.trips, s.items, s.goodsEur, s.extraEur, s.totalEur]),
      totals: ['Total', t.trips, t.items, t.goodsEur, t.extraEur, t.totalEur],
    },
    {
      name: 'Items bought',
      columns: [
        { header: 'Date', kind: 'date' },
        { header: 'Trip' },
        { header: 'Supplier' },
        { header: 'Category' },
        { header: 'Design' },
        { header: 'Colour' },
        { header: 'Size' },
        { header: 'SKU' },
        { header: 'Qty', kind: 'int' },
        { header: 'Price each', kind: 'money' },
        { header: 'Paid in' },
        { header: 'Price each €', kind: 'money' },
        { header: 'Trip costs each €', kind: 'money' },
        { header: 'Cost each €', kind: 'money' },
        { header: 'Total €', kind: 'money' },
      ],
      rows: r.lines.map((l) => [
        l.date,
        l.reference,
        l.supplier,
        l.category,
        l.design,
        l.colour,
        l.size,
        l.sku,
        l.qty,
        l.unitPrice,
        l.currency,
        l.unitPriceEur,
        l.extraEur,
        l.landedEur,
        l.totalEur,
      ]),
      totals: ['Total', null, null, null, null, null, null, null, t.items, null, null, null, null, null, t.totalEur],
    },
  ];
}
