-- Read-only. Run after 202610160001_demo_chain.sql; expect seven rows, all ok=true.
-- This checks the demo registry, not another contract's ABI or event projection.
with required_tables(name, columns) as (
  values
    ('dapp_demo_chain_events', array['chain_id','contract_address','block_number',
      'block_hash','transaction_hash','log_index','event_name','product_id','payload']),
    ('dapp_demo_chain_sync', array['chain_id','contract_address','next_block',
      'anchor_hash','updated_at']),
    ('dapp_demo_private_payloads', array['chain_id','contract_address','commitment',
      'author_wallet','product_id','claim_id','kind','body','nonce','created_at']),
    ('dapp_demo_product_images', array['chain_id','contract_address','product_id','image_path'])
), tables as (
  select r.*, to_regclass('public.' || r.name) as oid from required_tables r
), functions(signature) as (
  values
    ('public.dapp_demo_ingest_events(integer,text,bigint,bigint,text,jsonb)'),
    ('public.dapp_demo_reset_index(integer,text,bigint,text,bigint)')
), checks as (
  select 'base tables' as check_name,
    count(*) = 6 as ok,
    'Six existing business tables must be present.' as expected
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relname in (
    'dapp_profiles','dapp_products','dapp_transfers','dapp_claims',
    'dapp_ownership_events','dapp_service_records'
  )
  union all
  select 'public.' || t.name,
    coalesce(c.relkind='r' and c.relrowsecurity and
      not exists (
        select 1 from unnest(t.columns) column_name
        where not exists (
          select 1 from pg_catalog.pg_attribute a
          where a.attrelid=t.oid and a.attname=column_name
            and a.attnum>0 and not a.attisdropped
        )
      ) and not exists (
        select 1 from unnest(array['anon','authenticated']) client_role
        cross join unnest(array['SELECT','INSERT','UPDATE','DELETE',
          'TRUNCATE','REFERENCES','TRIGGER']) privilege
        where has_table_privilege(client_role,t.oid,privilege)
      ) and not exists (
        select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE']) privilege
        where not has_table_privilege('service_role',t.oid,privilege)
      ), false),
    'Required columns; RLS on; clients have no privileges; service_role has all four DML privileges.'
  from tables t left join pg_catalog.pg_class c on c.oid=t.oid
  union all
  select f.signature,
    coalesce(p.prosecdef and p.proconfig @> array['search_path=public'] and
      not has_function_privilege('anon',p.oid,'EXECUTE') and
      not has_function_privilege('authenticated',p.oid,'EXECUTE') and
      has_function_privilege('service_role',p.oid,'EXECUTE'), false),
    'Expected signature; SECURITY DEFINER; fixed search_path; only service_role can execute among app roles.'
  from functions f
  left join pg_catalog.pg_proc p on p.oid=to_regprocedure(f.signature)
)
select check_name, ok, expected from checks order by check_name;
