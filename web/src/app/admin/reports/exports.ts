import { t } from '../../core/i18n';
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
// the rows underneath, so anything can be filtered or summed further. Sheet and
// column names are in the language on screen when it's downloaded.

const x = (key: string) => t(`xlsx.${key}`);

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
      { header: x('orders'), kind: 'int' },
      { header: x('items'), kind: 'int' },
      { header: x('salesEuros'), kind: 'money' },
      { header: x('costEuros'), kind: 'money' },
      { header: x('profitEuros'), kind: 'money' },
      { header: x('margin'), kind: 'percent' },
    ],
    rows: groups.map((g) => [g.label, g.orders, g.items, g.sales, g.cost, g.profit, margin(g.profit, g.sales)]),
    totals: [x('total'), r.orders, r.items, r.sales, r.cost, r.profit, r.margin],
  });

  return [
    {
      name: x('summary'),
      columns: [
        { header: x('period') },
        { header: x('orders'), kind: 'int' },
        { header: x('items'), kind: 'int' },
        { header: x('salesEuros'), kind: 'money' },
        { header: x('costEuros'), kind: 'money' },
        { header: x('profitEuros'), kind: 'money' },
        { header: x('margin'), kind: 'percent' },
        { header: x('cashInEuros'), kind: 'money' },
        { header: x('refundsEuros'), kind: 'money' },
        { header: x('deliveryFeesEuros'), kind: 'money' },
        { header: x('cashInEUR'), kind: 'money' },
        { header: x('cashInMKD'), kind: 'money' },
        { header: x('cashInALL'), kind: 'money' },
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
    groupSheet(x('byDesign'), x('design'), r.byDesign),
    groupSheet(x('byCategory'), x('category'), r.byCategory),
    groupSheet(x('byCountry'), x('country'), r.byCountry),
    groupSheet(x('shopOrDM'), x('whereItWasOrdered'), r.byChannel),
    groupSheet(x('byMonth'), x('month'), r.byMonth),
    {
      name: x('orders'),
      columns: [
        { header: x('paidOn'), kind: 'date' },
        { header: x('order') },
        { header: x('customer') },
        { header: x('country') },
        { header: x('ordered') },
        { header: x('items'), kind: 'int' },
        { header: x('salesEuros'), kind: 'money' },
        { header: x('costEuros'), kind: 'money' },
        { header: x('profitEuros'), kind: 'money' },
        { header: x('currency') },
        { header: x('collected'), kind: 'money' },
        { header: x('refunded'), kind: 'money' },
        { header: x('collectedEuros'), kind: 'money' },
        { header: x('refundedEuros'), kind: 'money' },
        { header: x('deliveryFeeEuros'), kind: 'money' },
      ],
      rows: r.orderRows.map((o) => [
        o.paidOn,
        o.orderNumber,
        o.customer,
        t(COUNTRY_NAME[o.country]),
        t(CHANNEL_LABEL[o.channel]),
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
      name: x('itemsSold'),
      columns: [
        { header: x('paidOn'), kind: 'date' },
        { header: x('order') },
        { header: x('customer') },
        { header: x('country') },
        { header: x('ordered') },
        { header: x('category') },
        { header: x('design') },
        { header: x('colour') },
        { header: x('size') },
        { header: x('SKU') },
        { header: x('qty'), kind: 'int' },
        { header: x('priceEachEuros'), kind: 'money' },
        { header: x('salesEuros'), kind: 'money' },
        { header: x('costEuros'), kind: 'money' },
        { header: x('profitEuros'), kind: 'money' },
      ],
      rows: r.lines.map((l) => [
        l.paidOn,
        l.orderNumber,
        l.customer,
        t(COUNTRY_NAME[l.country]),
        t(CHANNEL_LABEL[l.channel]),
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
      totals: [x('total'), null, null, null, null, null, null, null, null, null, r.items, null, r.sales, r.cost, r.profit],
    },
  ];
}

// ---------------------------------------------------------------------------
// Money owed

export function owedSheets(r: OwedReport): Sheet[] {
  const owedColumns = (when: string): Column[] => [
    { header: x('order') },
    { header: x('customer') },
    { header: x('phone') },
    { header: x('town') },
    { header: x('country') },
    { header: x('courier') },
    { header: when, kind: 'date' },
    { header: x('days'), kind: 'int' },
    { header: x('currency') },
    { header: x('due'), kind: 'money' },
    { header: x('dueEuros'), kind: 'money' },
  ];
  const owedRows = (list: OwedReport['delivered']) =>
    list.map((o) => [o.orderNumber, o.customer, o.phone, o.city, t(COUNTRY_NAME[o.country]), o.courier, o.since, o.days, o.currency, o.due, o.dueEur]);

  return [
    {
      name: x('courierOwes'),
      columns: owedColumns(x('deliveredOn')),
      rows: owedRows(r.delivered),
      totals: [x('total'), null, null, null, null, null, null, null, null, null, r.deliveredEur],
    },
    {
      name: x('outForDelivery'),
      columns: owedColumns(x('sentOn')),
      rows: owedRows(r.onTheWay),
      totals: [x('total'), null, null, null, null, null, null, null, null, null, r.onTheWayEur],
    },
    {
      name: x('comingBack'),
      columns: [
        { header: x('order') },
        { header: x('customer') },
        { header: x('town') },
        { header: x('country') },
        { header: x('why') },
        { header: x('since'), kind: 'date' },
        { header: x('days'), kind: 'int' },
        { header: x('design') },
        { header: x('colour') },
        { header: x('size') },
        { header: x('qty'), kind: 'int' },
      ],
      rows: r.comingBack.flatMap((c) =>
        c.items.map((i) => [
          c.orderNumber,
          c.customer,
          c.city,
          t(COUNTRY_NAME[c.country]),
          c.why === 'not_delivered' ? x('notDelivered') : x('handedBackAtTheDoor'),
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
      { header: x('sizes'), kind: 'int' },
      { header: x('onTheShelf'), kind: 'int' },
      { header: x('available'), kind: 'int' },
      { header: x('onTheRoad'), kind: 'int' },
      { header: x('damaged'), kind: 'int' },
      { header: x('shelfAtCostEuros'), kind: 'money' },
      { header: x('shelfAtPriceEuros'), kind: 'money' },
    ],
    rows: groups.map((g) => [g.label, g.skus, g.shelf, g.available, g.road, g.damaged, g.valueCost, g.valuePrice]),
    totals: [x('total'), r.totals.skus, r.totals.shelf, r.totals.available, r.totals.road, r.totals.damaged, r.totals.valueCost, r.totals.valuePrice],
  });

  const t = r.totals;
  return [
    {
      name: x('summary'),
      columns: [
        { header: x('sizes'), kind: 'int' },
        { header: x('onTheShelf'), kind: 'int' },
        { header: x('reserved'), kind: 'int' },
        { header: x('available'), kind: 'int' },
        { header: x('onTheRoad'), kind: 'int' },
        { header: x('damaged'), kind: 'int' },
        { header: x('shelfAtCostEuros'), kind: 'money' },
        { header: x('shelfAtPriceEuros'), kind: 'money' },
        { header: x('onTheRoadAtCostEuros'), kind: 'money' },
        { header: x('damagedAtCostEuros'), kind: 'money' },
        { header: x('soldOut'), kind: 'int' },
        { header: x('runningLow'), kind: 'int' },
      ],
      rows: [[t.skus, t.shelf, t.reserved, t.available, t.road, t.damaged, t.valueCost, t.valuePrice, t.roadCost, t.damagedCost, t.soldOut, t.low]],
    },
    groupSheet(x('byCategory'), x('category'), r.byCategory),
    groupSheet(x('byDesign'), x('design'), r.byDesign),
    {
      name: x('everySize'),
      columns: [
        { header: x('category') },
        { header: x('design') },
        { header: x('colour') },
        { header: x('size') },
        { header: x('SKU') },
        { header: x('forSale') },
        { header: x('onTheShelf'), kind: 'int' },
        { header: x('reserved'), kind: 'int' },
        { header: x('available'), kind: 'int' },
        { header: x('onTheRoad'), kind: 'int' },
        { header: x('damaged'), kind: 'int' },
        { header: x('lowAt'), kind: 'int' },
        { header: x('costEuros'), kind: 'money' },
        { header: x('priceEuros'), kind: 'money' },
        { header: x('shelfAtCostEuros'), kind: 'money' },
        { header: x('shelfAtPriceEuros'), kind: 'money' },
      ],
      rows: r.lines.map((l) => [
        l.category,
        l.design,
        l.colour,
        l.size,
        l.sku,
        l.forSale ? x('yes') : x('no'),
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
      totals: [x('total'), null, null, null, null, null, t.shelf, t.reserved, t.available, t.road, t.damaged, null, null, null, t.valueCost, t.valuePrice],
    },
  ];
}

// ---------------------------------------------------------------------------
// Buying

export function buyingSheets(r: BuyingReport): Sheet[] {
  const t = r.totals;
  return [
    {
      name: x('trips'),
      columns: [
        { header: x('date'), kind: 'date' },
        { header: x('trip') },
        { header: x('supplier') },
        { header: x('paidIn') },
        { header: x('items'), kind: 'int' },
        { header: x('goodsEuros'), kind: 'money' },
        { header: x('tripCostsEuros'), kind: 'money' },
        { header: x('totalEuros'), kind: 'money' },
        { header: x('perItemEuros'), kind: 'money' },
      ],
      rows: r.trips.map((p) => [p.date, p.reference, p.supplier, p.currency, p.items, p.goodsEur, p.extraEur, p.totalEur, p.perItemEur]),
      totals: [x('total'), null, null, null, t.items, t.goodsEur, t.extraEur, t.totalEur, t.items ? Math.round((t.totalEur / t.items) * 100) / 100 : null],
    },
    {
      name: x('bySupplier'),
      columns: [
        { header: x('supplier') },
        { header: x('trips'), kind: 'int' },
        { header: x('items'), kind: 'int' },
        { header: x('goodsEuros'), kind: 'money' },
        { header: x('tripCostsEuros'), kind: 'money' },
        { header: x('totalEuros'), kind: 'money' },
      ],
      rows: r.bySupplier.map((s) => [s.label, s.trips, s.items, s.goodsEur, s.extraEur, s.totalEur]),
      totals: [x('total'), t.trips, t.items, t.goodsEur, t.extraEur, t.totalEur],
    },
    {
      name: x('itemsBought'),
      columns: [
        { header: x('date'), kind: 'date' },
        { header: x('trip') },
        { header: x('supplier') },
        { header: x('category') },
        { header: x('design') },
        { header: x('colour') },
        { header: x('size') },
        { header: x('SKU') },
        { header: x('qty'), kind: 'int' },
        { header: x('priceEach'), kind: 'money' },
        { header: x('paidIn') },
        { header: x('priceEachEuros'), kind: 'money' },
        { header: x('tripCostsEachEuros'), kind: 'money' },
        { header: x('costEachEuros'), kind: 'money' },
        { header: x('totalEuros'), kind: 'money' },
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
      totals: [x('total'), null, null, null, null, null, null, null, t.items, null, null, null, null, null, t.totalEur],
    },
  ];
}
