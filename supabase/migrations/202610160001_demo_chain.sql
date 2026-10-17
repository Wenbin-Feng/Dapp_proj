-- Additive, independent demo-contract read model. Run AFTER 202610140001_initial.sql.
-- Only server service_role can write verified events or read private repair text.
begin;

create table if not exists public.dapp_demo_chain_events (
  chain_id integer not null check (chain_id in (31337,11155111)),
  contract_address text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  block_number bigint not null check (block_number >= 0),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  event_name text not null check (event_name in ('RoleEnrolled','ProductRegistered','TransferRequested','TransferResolved','ClaimSubmitted','ClaimResolved')),
  product_id uuid,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key(chain_id,contract_address,transaction_hash,log_index)
);
create index if not exists dapp_demo_events_product on public.dapp_demo_chain_events(chain_id,contract_address,product_id,block_number,log_index);
create index if not exists dapp_demo_events_order on public.dapp_demo_chain_events(chain_id,contract_address,block_number,log_index);

create table if not exists public.dapp_demo_chain_sync (
  chain_id integer not null check (chain_id in (31337,11155111)),
  contract_address text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  next_block bigint not null check (next_block >= 0),
  anchor_hash text check (anchor_hash ~ '^0x[0-9a-f]{64}$'),
  updated_at timestamptz not null default now(),
  primary key(chain_id,contract_address)
);

create table if not exists public.dapp_demo_private_payloads (
  chain_id integer not null check (chain_id in (31337,11155111)),
  contract_address text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  commitment text not null check (commitment ~ '^0x[0-9a-f]{64}$'),
  author_wallet text not null check (author_wallet ~ '^0x[0-9a-f]{40}$'),
  product_id uuid not null,
  claim_id uuid not null,
  kind text not null check (kind in ('description','reason','resolution')),
  body text not null check (length(body) between 1 and 2000),
  nonce text not null check (nonce ~ '^0x[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key(chain_id,contract_address,commitment)
);

alter table public.dapp_demo_chain_events enable row level security;
alter table public.dapp_demo_chain_sync enable row level security;
alter table public.dapp_demo_private_payloads enable row level security;
create table if not exists public.dapp_demo_product_images (
  chain_id integer not null check (chain_id in (31337,11155111)),
  contract_address text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  product_id uuid not null,
  image_path text,
  primary key(chain_id,contract_address,product_id)
);
alter table public.dapp_demo_product_images enable row level security;
revoke all on public.dapp_demo_product_images from public,anon,authenticated;
grant select,insert,update,delete on public.dapp_demo_product_images to service_role;
revoke all on public.dapp_demo_chain_events,public.dapp_demo_chain_sync,public.dapp_demo_private_payloads from public,anon,authenticated;
grant select,insert,update,delete on public.dapp_demo_chain_events,public.dapp_demo_chain_sync,public.dapp_demo_private_payloads to service_role;

create or replace function public.dapp_demo_ingest_events(
  p_chain_id integer,p_contract text,p_expected_next bigint,p_next bigint,p_anchor text,p_events jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare current_cursor public.dapp_demo_chain_sync; item jsonb; existing public.dapp_demo_chain_events; count_events integer:=0;
begin
  if p_events is null or p_anchor is null or p_next <= p_expected_next or p_expected_next < 0 or p_next-p_expected_next > 2000
    or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events)>10000 then
    raise exception 'INVALID_INPUT: Invalid index batch';
  end if;
  insert into public.dapp_demo_chain_sync(chain_id,contract_address,next_block) values(p_chain_id,p_contract,p_expected_next) on conflict do nothing;
  select * into current_cursor from public.dapp_demo_chain_sync where chain_id=p_chain_id and contract_address=p_contract for update;
  if current_cursor.next_block <> p_expected_next then return jsonb_build_object('applied',false,'next_block',current_cursor.next_block::text); end if;
  for item in select value from jsonb_array_elements(p_events) loop
    if (item->>'block_number')::bigint < p_expected_next or (item->>'block_number')::bigint >= p_next then raise exception 'INVALID_INPUT: Event outside batch'; end if;
    select * into existing from public.dapp_demo_chain_events where chain_id=p_chain_id and contract_address=p_contract and transaction_hash=item->>'transaction_hash' and log_index=(item->>'log_index')::integer;
    if found then
      if existing.block_hash <> item->>'block_hash' or existing.payload <> item->'payload' or existing.event_name <> item->>'event_name' then raise exception 'CONFLICT: Event differs from saved evidence'; end if;
    else
      insert into public.dapp_demo_chain_events(chain_id,contract_address,block_number,block_hash,transaction_hash,log_index,event_name,product_id,payload)
        values(p_chain_id,p_contract,(item->>'block_number')::bigint,item->>'block_hash',item->>'transaction_hash',(item->>'log_index')::integer,item->>'event_name',(item->>'product_id')::uuid,item->'payload');
      count_events:=count_events+1;
    end if;
  end loop;
  update public.dapp_demo_chain_sync set next_block=p_next,anchor_hash=p_anchor,updated_at=now() where chain_id=p_chain_id and contract_address=p_contract;
  return jsonb_build_object('applied',true,'next_block',p_next::text,'event_count',count_events);
end $$;

create or replace function public.dapp_demo_reset_index(
  p_chain_id integer,p_contract text,p_expected_next bigint,p_expected_anchor text,p_from_block bigint
) returns boolean language plpgsql security definer set search_path=public as $$
declare current_cursor public.dapp_demo_chain_sync;
begin
  if p_from_block < 0 then raise exception 'INVALID_INPUT: Invalid start block'; end if;
  select * into current_cursor from public.dapp_demo_chain_sync where chain_id=p_chain_id and contract_address=p_contract for update;
  if not found or current_cursor.next_block <> p_expected_next or current_cursor.anchor_hash is distinct from p_expected_anchor then return false; end if;
  delete from public.dapp_demo_chain_events where chain_id=p_chain_id and contract_address=p_contract;
  update public.dapp_demo_chain_sync set next_block=p_from_block,anchor_hash=null,updated_at=now() where chain_id=p_chain_id and contract_address=p_contract;
  return true;
end $$;

revoke all on function public.dapp_demo_ingest_events(integer,text,bigint,bigint,text,jsonb) from public,anon,authenticated;
revoke all on function public.dapp_demo_reset_index(integer,text,bigint,text,bigint) from public,anon,authenticated;
grant execute on function public.dapp_demo_ingest_events(integer,text,bigint,bigint,text,jsonb) to service_role;
grant execute on function public.dapp_demo_reset_index(integer,text,bigint,text,bigint) to service_role;
commit;
