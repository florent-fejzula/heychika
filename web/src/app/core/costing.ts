// What a buying trip really costs per item, shown before the purchase is received.
//
// This is a preview. The database does the real calculation when a purchase is
// received (receive_purchase in supabase/migrations) and stores the result; this
// mirrors it so what is shown beforehand matches what gets stored. The same worked
// examples are tested on both sides (costing.spec.ts here, costing.test.js there).

export type AllocationMethod = 'by_quantity' | 'by_value';

export interface CostLine {
  qty: number;
  /** In the purchase currency. */
  unitPrice: number;
}

export interface LandedLine {
  unitPriceEur: number;
  /** This item's share of the trip costs. */
  extraEur: number;
  /** What one item really cost to get here: price plus its share of the trip. */
  landedEur: number;
}

export interface CostOptions {
  /** Units of the purchase currency per €1. Use 1 for euros. */
  currencyPerEur: number;
  extraCostsEur: number;
  method: AllocationMethod;
}

export type CostProblem = 'no_items' | 'zero_value';

export interface CostResult {
  lines: LandedLine[];
  totalQty: number;
  goodsEur: number;
  problem: CostProblem | null;
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

export function landedCosts(lines: CostLine[], opts: CostOptions): CostResult {
  const totalQty = lines.reduce((sum, l) => sum + l.qty, 0);
  const goodsEur = lines.reduce((sum, l) => sum + (l.qty * l.unitPrice) / opts.currencyPerEur, 0);

  const problem: CostProblem | null =
    totalQty === 0 ? 'no_items' : opts.method === 'by_value' && goodsEur === 0 && opts.extraCostsEur > 0 ? 'zero_value' : null;

  return {
    totalQty,
    goodsEur: round4(goodsEur),
    problem,
    lines: lines.map((l) => {
      const unitPriceEur = l.unitPrice / opts.currencyPerEur;
      let extraEur = 0;
      if (!problem && opts.extraCostsEur > 0) {
        extraEur = opts.method === 'by_quantity' ? opts.extraCostsEur / totalQty : opts.extraCostsEur * (unitPriceEur / goodsEur);
      }
      return { unitPriceEur: round4(unitPriceEur), extraEur: round4(extraEur), landedEur: round4(unitPriceEur + extraEur) };
    }),
  };
}

/**
 * The cost of an item after more arrive at a different price: what is on the shelf
 * and what arrives, averaged by quantity.
 */
export function weightedAverage(currentCost: number, onHand: number, landed: number, received: number): number {
  return round4((currentCost * onHand + landed * received) / (onHand + received));
}
