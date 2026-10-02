import {
  HandedBackRow,
  OwedOrderRow,
  PurchaseReportRow,
  SaleOrderRow,
  StockReportRow,
  buyingReport,
  endOfDay,
  expectedCash,
  localDate,
  owedReport,
  periodFor,
  periodLabel,
  salesReport,
  soldQty,
  startOfDay,
  stockReport,
  unitSaleEur,
} from './reports';

// Midday, so the tests read the same in any time zone.
const at = (date: string) => new Date(`${date}T12:00:00`).toISOString();

type SaleLineRow = SaleOrderRow['lines'][number];

function saleLine(design: [id: number, name: string, category: string], qty: number, extra: Partial<SaleLineRow> = {}): SaleLineRow {
  return {
    qty, returned_qty: 0, refused_qty: 0, unit_price_eur: 25, unit_price_in_currency: null, unit_cost_eur: 10,
    sku_snapshot: `X-${design[0]}`, product_name_snapshot: design[1], color_snapshot: 'Black', size_snapshot: 'M',
    variant: { product: { id: design[0], name: design[1], category: { name: design[2] } } },
    ...extra,
  };
}

const WRAP: [number, string, string] = [1, 'Wrap dress', 'Dresses'];
const SILK: [number, string, string] = [2, 'Silk top', 'Tops'];

function saleOrder(id: number, extra: Partial<SaleOrderRow>): SaleOrderRow {
  return {
    id, order_number: `HC-2026-000${id}`, channel: 'online', country: 'XK', currency: 'EUR', currency_per_eur: 1,
    delivery_fee_eur: 2, amount_collected: 0, paid_at: at('2026-10-05'), customer: { first_name: 'Arta', last_name: 'K' },
    lines: [], returns: [], ...extra,
  };
}

describe('periods', () => {
  it('this month, last month (across a new year), this year, last year, all time', () => {
    const jan = new Date(2027, 0, 15);
    expect(periodFor('month', jan)).toEqual({ from: '2027-01-01', to: '2027-01-31' });
    expect(periodFor('last_month', jan)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(periodFor('year', jan)).toEqual({ from: '2027-01-01', to: '2027-12-31' });
    expect(periodFor('last_year', jan)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodFor('all', jan)).toEqual({ from: null, to: null });
    expect(periodFor('month', new Date(2028, 1, 10)).to).toBe('2028-02-29');
  });

  it('describes a period in words', () => {
    expect(periodLabel({ from: '2026-10-01', to: '2026-10-31' })).toBe('1 Oct 2026 – 31 Oct 2026');
    expect(periodLabel({ from: null, to: null })).toBe('All time');
    expect(periodLabel({ from: '2026-03-03', to: null })).toBe('Since 3 Mar 2026');
  });

  it('a day runs from local midnight to the next', () => {
    expect(localDate(startOfDay('2026-10-05'))).toBe('2026-10-05');
    expect(localDate(new Date(new Date(endOfDay('2026-10-05')).getTime() - 1))).toBe('2026-10-05');
    expect(localDate(endOfDay('2026-12-31'))).toBe('2027-01-01');
  });
});

describe('order lines', () => {
  it('counts only what the customer kept, at the price they saw in their currency', () => {
    const l = { qty: 3, returned_qty: 1, refused_qty: 1, unit_price_eur: 25, unit_price_in_currency: 1550 };
    expect(soldQty(l)).toBe(1);
    expect(unitSaleEur(l, 61.5)).toBeCloseTo(25.2, 2); // 1550 MKD, not the €25 list price
    expect(unitSaleEur({ ...l, unit_price_in_currency: null }, 1)).toBe(25);
  });

  it('expects the courier to bring the total less what came or was handed back', () => {
    const o = {
      total_in_currency: 3350, currency_per_eur: 61.5,
      lines: [
        { qty: 2, returned_qty: 0, refused_qty: 1, unit_price_eur: 25, unit_price_in_currency: 1550 },
        { qty: 1, returned_qty: 0, refused_qty: 0, unit_price_eur: 2, unit_price_in_currency: 150 },
      ],
    };
    expect(expectedCash(o)).toBe(1800);
  });
});

describe('salesReport', () => {
  // A Macedonian shop order: 2 wrap dresses at 1550 MKD (one handed back at the door) and a
  // silk top at 1550, 250 delivery. The courier brought 3350.
  const skopje = saleOrder(1, {
    country: 'MK', currency: 'MKD', currency_per_eur: 61.5, amount_collected: 3350, delivery_fee_eur: 4,
    lines: [
      saleLine(WRAP, 2, { refused_qty: 1, unit_price_in_currency: 1550, unit_cost_eur: 10 }),
      saleLine(SILK, 1, { unit_price_in_currency: 1550, unit_cost_eur: 12 }),
    ],
  });
  // A DM order in Kosovo, a month earlier: 2 silk tops at an agreed €20, one sent back for €20.
  const prishtina = saleOrder(2, {
    channel: 'manual', paid_at: at('2026-09-20'), amount_collected: 42,
    lines: [saleLine(SILK, 2, { returned_qty: 1, unit_price_eur: 20, unit_cost_eur: 12 })],
    returns: [{ refund_amount_eur: 20, refund_amount_currency: 20 }],
  });
  // Everything sent back and refunded: not a sale, and no money kept.
  const refunded = saleOrder(3, {
    amount_collected: 27,
    lines: [saleLine(WRAP, 1, { returned_qty: 1 })],
    returns: [{ refund_amount_eur: 27, refund_amount_currency: 27 }],
  });

  const r = salesReport([skopje, prishtina, refunded]);

  it('adds up what was kept, at the prices paid, less what it cost', () => {
    expect(r.orders).toBe(2);
    expect(r.items).toBe(3);
    // 2 x 1550 MKD / 61.5 = 50.40, + €20
    expect(r.sales).toBe(70.4);
    expect(r.cost).toBe(34);
    expect(r.profit).toBe(36.4);
    expect(r.margin).toBeCloseTo(36.4 / 70.4, 6);
  });

  it('keeps cash in each currency as it was handed over, less refunds, and delivery apart from sales', () => {
    expect(r.cash).toEqual({ EUR: 22, MKD: 3350, ALL: 0 });
    expect(r.refundsEur).toBe(47);
    expect(r.cashEur).toBe(Math.round((3350 / 61.5 + 42 + 27 - 47) * 100) / 100);
    expect(r.deliveryEur).toBe(6); // the fully refunded order's fee isn't counted
  });

  it('breaks the sales down by design, category, country, shop or DM, and month', () => {
    expect(r.byDesign.map((g) => [g.label, g.items, g.sales])).toEqual([
      ['Silk top', 2, 45.2],
      ['Wrap dress', 1, 25.2],
    ]);
    expect(r.byCategory.map((g) => g.label)).toEqual(['Tops', 'Dresses']);
    expect(r.byCountry.map((g) => [g.label, g.orders])).toEqual([['North Macedonia', 1], ['Kosovo', 1]]);
    expect(r.byChannel.map((g) => g.label)).toEqual(['Online shop', 'From a DM']);
    expect(r.byMonth.map((g) => [g.key, g.label, g.sales])).toEqual([['2026-09', 'Sept 2026', 20], ['2026-10', 'Oct 2026', 50.4]]);
  });

  it('lists every order and every item sold, for Excel', () => {
    expect(r.orderRows.map((o) => [o.orderNumber, o.items, o.collected, o.refunded])).toEqual([
      ['HC-2026-0001', 2, 3350, 0],
      ['HC-2026-0002', 1, 42, 20],
      ['HC-2026-0003', 0, 27, 27],
    ]);
    expect(r.lines).toHaveLength(3);
    expect(r.lines[0]).toMatchObject({ paidOn: '2026-10-05', design: 'Wrap dress', qty: 1, sales: 25.2, cost: 10, profit: 15.2 });
  });

  it('flags items sold with no cost, so the profit isn’t taken at face value', () => {
    const noCost = salesReport([saleOrder(4, { amount_collected: 27, lines: [saleLine(WRAP, 1, { unit_cost_eur: 0 })] })]);
    expect(noCost.uncosted).toBe(1);
    expect(r.uncosted).toBe(0);
  });

  it('is empty, not broken, with no sales', () => {
    const none = salesReport([]);
    expect(none).toMatchObject({ orders: 0, sales: 0, profit: 0, margin: null, byDesign: [] });
  });
});

describe('owedReport', () => {
  const today = new Date(2026, 9, 20, 12);
  const lines = (refused = 0): OwedOrderRow['lines'] => [
    { qty: 2, returned_qty: 0, refused_qty: refused, unit_price_eur: 25, unit_price_in_currency: 1550, product_name_snapshot: 'Wrap dress', color_snapshot: 'Black', size_snapshot: 'M' },
  ];
  function owed(id: number, extra: Partial<OwedOrderRow>): OwedOrderRow {
    return {
      id, order_number: `HC-2026-000${id}`, status: 'delivered', country: 'MK', currency: 'MKD', currency_per_eur: 61.5,
      total_in_currency: 3350, dispatched_at: at('2026-10-10'), delivered_at: at('2026-10-12'), delivery_name: 'Arta',
      delivery_phone: '+38970123456', delivery_city: 'Skopje', courier_name: 'Post Express', lines: lines(), ...extra,
    };
  }

  const handedBack: HandedBackRow[] = [
    { refused_qty: 1, product_name_snapshot: 'Wrap dress', color_snapshot: 'Black', size_snapshot: 'M',
      order: { id: 1, order_number: 'HC-2026-0001', country: 'MK', delivered_at: at('2026-10-12'), delivery_name: 'Arta', delivery_city: 'Skopje' } },
    { refused_qty: 1, product_name_snapshot: 'Silk top', color_snapshot: 'Cream', size_snapshot: 'S',
      order: { id: 1, order_number: 'HC-2026-0001', country: 'MK', delivered_at: at('2026-10-12'), delivery_name: 'Arta', delivery_city: 'Skopje' } },
  ];

  const r = owedReport(
    [
      owed(1, { lines: lines(1) }),
      owed(2, { delivered_at: at('2026-10-02'), country: 'XK', currency: 'EUR', currency_per_eur: 1, total_in_currency: 52, lines: [] }),
      owed(3, { status: 'dispatched', delivered_at: null, dispatched_at: at('2026-10-19') }),
      owed(4, { status: 'delivery_failed', delivered_at: null }),
    ],
    handedBack,
    today,
  );

  it('splits money the courier holds from parcels still out, oldest first', () => {
    expect(r.delivered.map((o) => [o.orderNumber, o.due, o.days])).toEqual([
      ['HC-2026-0002', 52, 18],
      ['HC-2026-0001', 1800, 8], // 3350 less the dress handed back at the door
    ]);
    expect(r.onTheWay.map((o) => [o.orderNumber, o.due, o.days])).toEqual([['HC-2026-0003', 3350, 1]]);
  });

  it('totals what’s owed in each currency, and in euros', () => {
    expect(r.deliveredTotal).toEqual({ EUR: 52, MKD: 1800, ALL: 0 });
    expect(r.deliveredEur).toBe(Math.round((52 + 1800 / 61.5) * 100) / 100);
    expect(r.onTheWayTotal.MKD).toBe(3350);
  });

  it('lists what is on its way back: undelivered parcels, and items handed back, grouped by order', () => {
    expect(r.comingBack.map((c) => [c.orderNumber, c.why, c.items.length])).toEqual([
      ['HC-2026-0004', 'not_delivered', 1],
      ['HC-2026-0001', 'handed_back', 2],
    ]);
    expect(r.comingBack[0].items[0]).toEqual({ name: 'Wrap dress', colour: 'Black', size: 'M', qty: 2 });
  });
});

describe('stockReport', () => {
  function variant(id: number, extra: Partial<StockReportRow>, qty: Partial<NonNullable<Extract<StockReportRow['stock'], { qty_physical: number }>>> = {}): StockReportRow {
    return {
      id, sku: `X-${id}`, active: true, price_eur: 30, cost_eur: 12,
      product: { id: 1, name: 'Wrap dress', status: 'active', category: { name: 'Dresses' } },
      color: { name: 'Black' }, size: { label: 'M', sort_order: 2 },
      stock: [{ qty_physical: 4, qty_reserved: 1, qty_available: 3, qty_in_transit: 1, qty_damaged: 0, min_stock: 0, ...qty }],
      ...extra,
    };
  }

  const r = stockReport([
    variant(1, {}),
    variant(2, { size: { label: 'S', sort_order: 1 } }, { qty_physical: 1, qty_reserved: 0, qty_available: 1, min_stock: 2, qty_in_transit: 0 }),
    variant(3, { product: { id: 2, name: 'Silk top', status: 'active', category: { name: 'Tops' } }, cost_eur: 0 },
      { qty_physical: 0, qty_reserved: 0, qty_available: 0, qty_in_transit: 0, qty_damaged: 2 }),
    // Never stocked and not for sale: left out.
    variant(4, { active: false }, { qty_physical: 0, qty_reserved: 0, qty_available: 0, qty_in_transit: 0 }),
  ]);

  it('values the shelf at cost and at price, and counts what’s on the road and damaged', () => {
    expect(r.lines.map((l) => l.sku)).toEqual(['X-2', 'X-1', 'X-3']); // by category, design, size
    expect(r.totals).toMatchObject({ skus: 3, shelf: 5, reserved: 1, available: 4, road: 1, damaged: 2, valueCost: 60, valuePrice: 150, roadCost: 12 });
  });

  it('counts sold-out and low sizes', () => {
    expect(r.totals.soldOut).toBe(1);
    expect(r.totals.low).toBe(1);
  });

  it('groups by category and by design, most valuable first', () => {
    expect(r.byCategory.map((g) => [g.label, g.shelf, g.valueCost])).toEqual([['Dresses', 5, 60], ['Tops', 0, 0]]);
    expect(r.byDesign.map((g) => g.label)).toEqual(['Wrap dress', 'Silk top']);
  });
});

describe('buyingReport', () => {
  function trip(id: number, supplier: string | null, date: string, lines: [qty: number, eur: number, extra: number][]): PurchaseReportRow {
    return {
      id, reference: `Trip ${id}`, supplier_name: supplier, purchase_date: date, currency: 'TRY',
      extra_costs_eur: lines.reduce((n, [q, , x]) => n + q * x, 0),
      lines: lines.map(([qty, eur, extra]) => ({
        qty, unit_price: eur * 35, unit_price_eur: eur, allocated_extra_eur: extra, unit_landed_cost_eur: eur + extra,
        variant: { sku: 'X', product: { name: 'Wrap dress', category: { name: 'Dresses' } }, color: { name: 'Black' }, size: { label: 'M' } },
      })),
    };
  }

  const r = buyingReport([
    trip(1, 'Laleli Moda', '2026-03-01', [[10, 8, 2], [5, 12, 2]]),
    trip(2, null, '2026-09-01', [[20, 6, 1]]),
    trip(3, 'Laleli Moda', '2026-06-01', [[4, 10, 5]]),
  ]);

  it('totals each trip with its costs spread over the items', () => {
    expect(r.trips.map((t) => [t.reference, t.items, t.goodsEur, t.extraEur, t.totalEur, t.perItemEur])).toEqual([
      ['Trip 2', 20, 120, 20, 140, 7],
      ['Trip 3', 4, 40, 20, 60, 15],
      ['Trip 1', 15, 140, 30, 170, 11.33],
    ]);
    expect(r.totals).toEqual({ trips: 3, items: 39, goodsEur: 300, extraEur: 70, totalEur: 370 });
  });

  it('groups by supplier, naming the trips that have none', () => {
    expect(r.bySupplier.map((s) => [s.label, s.trips, s.totalEur])).toEqual([
      ['Laleli Moda', 2, 230],
      ['No supplier named', 1, 140],
    ]);
    expect(r.lines).toHaveLength(4);
  });
});
