-- Read-only inventory. Run in the ORIGINAL team's Supabase project as an administrator.
-- All six base tables must exist before installation.
-- If all six demo objects exist, run verify_demo_chain.sql first; seven true means no reinstall.
-- If only some demo objects exist, or verification fails, stop and inspect before changing anything.
-- STOP if an existing object's type is unexpected; an occupied name is not a fresh install.
-- This inventory does not establish ownership or authorize deleting existing objects.
with tables(module, name) as (
  values
    ('base', 'dapp_profiles'),
    ('base', 'dapp_products'),
    ('base', 'dapp_transfers'),
    ('base', 'dapp_claims'),
    ('base', 'dapp_ownership_events'),
    ('base', 'dapp_service_records'),
    ('demo', 'dapp_demo_chain_events'),
    ('demo', 'dapp_demo_chain_sync'),
    ('demo', 'dapp_demo_private_payloads'),
    ('demo', 'dapp_demo_product_images')
), functions(signature) as (
  values
    ('public.dapp_demo_ingest_events(integer,text,bigint,bigint,text,jsonb)'),
    ('public.dapp_demo_reset_index(integer,text,bigint,text,bigint)')
)
select t.module, 'public.' || t.name as object_name,
  c.oid is not null as present,
  case when c.relkind='r' then 'table'
    when c.oid is not null then 'UNEXPECTED RELATION: STOP' end as object_type
from tables t
left join pg_catalog.pg_class c on c.oid=to_regclass('public.' || t.name)
union all
select 'demo', f.signature, p.oid is not null,
  case when p.prokind='f' then 'function'
    when p.oid is not null then 'UNEXPECTED ROUTINE: STOP' end
from functions f
left join pg_catalog.pg_proc p on p.oid=to_regprocedure(f.signature)
order by module, object_name;
