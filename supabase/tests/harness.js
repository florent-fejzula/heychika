// Loads the real migrations into an in-memory Postgres (PGlite), behind a shim
// that reproduces the parts of Supabase the schema depends on: the auth schema,
// auth.uid(), the anon/authenticated roles and Supabase's default grants.

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;

  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;

  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`;

export const STAFF_ID = '11111111-1111-1111-1111-111111111111';
export const STRANGER_ID = '22222222-2222-2222-2222-222222222222';

export async function freshDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);

  const migrations = readdirSync(join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const file of migrations) {
    try {
      await db.exec(readFileSync(join(root, 'migrations', file), 'utf8'));
    } catch (e) {
      throw new Error(`${file}: ${e.message}`);
    }
  }
  await db.exec(readFileSync(join(root, 'seed.sql'), 'utf8'));

  // One staff member with a profile; one logged-in stranger without.
  await db.exec(`
    insert into auth.users (id, email) values
      ('${STAFF_ID}', 'owner@heychika.test'),
      ('${STRANGER_ID}', 'stranger@example.test');
    insert into public.profiles (id, name) values ('${STAFF_ID}', 'Owner');
  `);

  return db;
}

// Run fn inside a transaction as a given Supabase role/user, then roll back
// nothing: changes persist, the role reverts at commit.
export async function as(db, who, fn) {
  const role = who === 'anon' ? 'anon' : 'authenticated';
  const sub = who === 'staff' ? STAFF_ID : who === 'stranger' ? STRANGER_ID : '';
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub]);
    await tx.exec(`set local role ${role}`);
    return fn(tx);
  });
}

export async function one(db, sql, params) {
  const { rows } = await db.query(sql, params);
  return rows[0];
}

export async function id(db, sql, params) {
  return (await one(db, sql, params)).id;
}

// Builders for the common setup steps

export async function product(db, { category = 'DR', name = 'Black satin wrap dress', slug, online = true } = {}) {
  return id(
    db,
    `insert into products (category_id, name, slug, status, show_online)
     values ((select id from categories where code = $1), $2, $3, $4, $5) returning id`,
    [category, name, slug ?? `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 7)}`,
     online ? 'active' : 'draft', online],
  );
}

export async function variant(db, productId, { color = 'BLK', size = 'M', price = 0 } = {}) {
  return id(
    db,
    `insert into variants (product_id, color_id, size_id, price_eur)
     values ($1, (select id from colors where code = $2), (select id from sizes where code = $3), $4) returning id`,
    [productId, color, size, price],
  );
}

export async function purchase(db, lines, { currency = 'EUR', rate = 1, extra = 0, method = 'by_quantity' } = {}) {
  const purchaseId = await id(
    db,
    `insert into purchases (reference, currency, currency_per_eur, extra_costs_eur, allocation_method)
     values ('test trip', $1, $2, $3, $4) returning id`,
    [currency, rate, extra, method],
  );
  for (const [variantId, qty, unitPrice] of lines) {
    await db.query(
      `insert into purchase_lines (purchase_id, variant_id, qty, unit_price) values ($1, $2, $3, $4)`,
      [purchaseId, variantId, qty, unitPrice],
    );
  }
  return purchaseId;
}

export async function receive(db, purchaseId) {
  await as(db, 'staff', (tx) => tx.query('select receive_purchase($1)', [purchaseId]));
}

export async function move(db, variantId, type, qty, opts = {}) {
  await db.query(
    `select private.apply_stock_movement($1, $2, $3, null, null, null, null, $4)`,
    [variantId, type, qty, opts.fromTransit ?? true],
  );
}

export async function stock(db, variantId) {
  const r = await one(
    db,
    `select qty_physical p, qty_reserved r, qty_available a, qty_in_transit t, qty_damaged d
       from stock where variant_id = $1`,
    [variantId],
  );
  return { physical: r.p, reserved: r.r, available: r.a, inTransit: r.t, damaged: r.d };
}
