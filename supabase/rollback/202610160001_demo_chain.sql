-- Uninstall only the EMPTY demo read-model module; this is not a database restore.
-- First switch the website to PRODUCT_BACKEND=database and stop demo writes, indexing and DDL.
-- Run the complete script as a database administrator. On any error, run ROLLBACK.
-- Any saved event, cursor, private body or image reference blocks all removal.
begin;
set local row_security = off;

do $uninstall$
declare
  target_table text;
  locked_tables text[] := array[]::text[];
  has_rows boolean;
begin
  foreach target_table in array array[
    'dapp_demo_chain_events',
    'dapp_demo_chain_sync',
    'dapp_demo_private_payloads',
    'dapp_demo_product_images'
  ] loop
    if to_regclass(format('public.%I', target_table)) is not null then
      execute format('lock table public.%I in access exclusive mode', target_table);
      locked_tables := array_append(locked_tables, target_table);
    end if;
  end loop;

  foreach target_table in array locked_tables loop
    execute format('select exists (select 1 from public.%I)', target_table) into has_rows;
    if has_rows then
      raise exception 'UNINSTALL_REFUSED: public.% contains data; no objects were removed', target_table;
    end if;
  end loop;

  drop function if exists public.dapp_demo_ingest_events(integer,text,bigint,bigint,text,jsonb) restrict;
  drop function if exists public.dapp_demo_reset_index(integer,text,bigint,text,bigint) restrict;

  foreach target_table in array locked_tables loop
    execute format('drop table public.%I restrict', target_table);
  end loop;
end
$uninstall$;

commit;
