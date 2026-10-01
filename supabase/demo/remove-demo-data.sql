-- Takes the demo products out again, along with everything that touched them:
-- the demo buying trip, its stock history, and any test orders (and the
-- customers made only by those orders).
--
-- Run in the Supabase SQL Editor before real launch. It only touches designs whose
-- link starts with "demo-". Real designs, real trips and real orders are left alone.
--
-- Stock history is normally permanent (the app never lets anyone delete it), so this
-- switches the protecting triggers off for the length of the script and back on at the
-- end. All in one transaction: if anything fails, nothing is removed.

begin;

alter table public.variants           disable trigger user;
alter table public.products           disable trigger user;
alter table public.stock_movements    disable trigger user;
alter table public.purchases          disable trigger user;
alter table public.purchase_lines     disable trigger user;
alter table public.orders             disable trigger user;
alter table public.order_lines        disable trigger user;
alter table public.returns            disable trigger user;
alter table public.return_lines       disable trigger user;
alter table public.variant_code_changes disable trigger user;

create temporary table demo_variants on commit drop as
  select v.id from public.variants v join public.products p on p.id = v.product_id where p.slug like 'demo-%';

create temporary table demo_orders on commit drop as
  select distinct l.order_id as id from public.order_lines l where l.variant_id in (select id from demo_variants);

create temporary table demo_customers on commit drop as
  select distinct o.customer_id as id from public.orders o where o.id in (select id from demo_orders);

-- Orders, and returns on them
delete from public.return_lines where return_id in (select id from public.returns where order_id in (select id from demo_orders));
delete from public.returns where order_id in (select id from demo_orders);
delete from public.order_status_history where order_id in (select id from demo_orders);
delete from public.order_lines where order_id in (select id from demo_orders);
delete from public.orders where id in (select id from demo_orders);

-- Customers who now have no orders at all
delete from public.customers c
 where c.id in (select id from demo_customers)
   and not exists (select 1 from public.orders o where o.customer_id = c.id);

-- Stock and buying trips
delete from public.stock_movements where variant_id in (select id from demo_variants);
delete from public.purchase_lines where variant_id in (select id from demo_variants);
delete from public.purchases p
 where p.reference like 'DEMO%'
   and not exists (select 1 from public.purchase_lines l where l.purchase_id = p.id);

-- The designs themselves
delete from public.variant_code_changes where variant_id in (select id from demo_variants);
delete from public.stock where variant_id in (select id from demo_variants);
delete from public.variants where id in (select id from demo_variants);
delete from public.product_images where product_id in (select id from public.products where slug like 'demo-%');
delete from public.products where slug like 'demo-%';

alter table public.variants           enable trigger user;
alter table public.products           enable trigger user;
alter table public.stock_movements    enable trigger user;
alter table public.purchases          enable trigger user;
alter table public.purchase_lines     enable trigger user;
alter table public.orders             enable trigger user;
alter table public.order_lines        enable trigger user;
alter table public.returns            enable trigger user;
alter table public.return_lines       enable trigger user;
alter table public.variant_code_changes enable trigger user;

commit;

-- Photos you uploaded for demo designs stay in Storage (they cost nothing); delete them from
-- Storage -> product-images if you want them gone.
