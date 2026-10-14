-- Origin classroom prototype. Business data is served exclusively by trusted
-- Next.js handlers; wallet sessions never receive direct database access.
create table if not exists public.dapp_profiles (
  id uuid primary key references auth.users(id),
  wallet_address text not null unique check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  role text not null check (role in ('manufacturer','retailer','customer','service_center')),
  organization_name text check (organization_name is null or length(btrim(organization_name)) between 1 and 120),
  onboarding_completed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table if not exists public.dapp_products (
  id uuid primary key default gen_random_uuid(),
  serial_number text not null check (serial_number = btrim(serial_number) and length(serial_number) between 1 and 120),
  model text not null check (length(btrim(model)) between 1 and 120),
  manufacturer_id uuid not null references public.dapp_profiles(id),
  manufacturer_name text not null,
  manufacturer_wallet text not null,
  owner_id uuid not null references public.dapp_profiles(id),
  owner_wallet text not null,
  warranty_duration_days integer not null check (warranty_duration_days between 1 and 36500),
  max_claims integer not null check (max_claims between 1 and 1000),
  claims_used integer not null default 0 check (claims_used >= 0 and claims_used <= max_claims),
  warranty_started_at timestamptz,
  warranty_expires_at timestamptz,
  image_path text,
  created_at timestamptz not null default now(),
  check ((warranty_started_at is null and warranty_expires_at is null) or (warranty_started_at is not null and warranty_expires_at > warranty_started_at))
);
create unique index if not exists dapp_products_serial_unique on public.dapp_products(lower(serial_number));
create index if not exists dapp_products_owner_idx on public.dapp_products(owner_id);
create table if not exists public.dapp_transfers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.dapp_products(id),
  from_user_id uuid not null references public.dapp_profiles(id),
  to_user_id uuid not null references public.dapp_profiles(id),
  from_wallet text not null,
  to_wallet text not null,
  status text not null default 'pending' check (status in ('pending','accepted','rejected','cancelled')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (from_user_id <> to_user_id)
);
create unique index if not exists dapp_one_pending_transfer on public.dapp_transfers(product_id) where status = 'pending';
create index if not exists dapp_transfers_from_idx on public.dapp_transfers(from_user_id);
create index if not exists dapp_transfers_to_idx on public.dapp_transfers(to_user_id);
create table if not exists public.dapp_claims (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.dapp_products(id),
  customer_id uuid not null references public.dapp_profiles(id),
  service_center_id uuid not null references public.dapp_profiles(id),
  description text not null check (length(btrim(description)) between 1 and 2000),
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','completed')),
  decision_reason text,
  resolution text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists dapp_one_open_claim on public.dapp_claims(product_id) where status in ('submitted','approved');
create index if not exists dapp_claims_customer_idx on public.dapp_claims(customer_id);
create index if not exists dapp_claims_center_idx on public.dapp_claims(service_center_id);
create table if not exists public.dapp_ownership_events (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.dapp_products(id),
  from_wallet text,
  to_wallet text not null,
  kind text not null check (kind in ('registered','transferred')),
  created_at timestamptz not null default now()
);
create index if not exists dapp_history_product_idx on public.dapp_ownership_events(product_id,created_at);
create table if not exists public.dapp_service_records (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.dapp_products(id),
  claim_id uuid not null unique references public.dapp_claims(id),
  service_center_id uuid not null references public.dapp_profiles(id),
  description text not null,
  created_at timestamptz not null default now()
);

alter table public.dapp_profiles enable row level security;
alter table public.dapp_products enable row level security;
alter table public.dapp_transfers enable row level security;
alter table public.dapp_claims enable row level security;
alter table public.dapp_ownership_events enable row level security;
alter table public.dapp_service_records enable row level security;
revoke all on public.dapp_profiles, public.dapp_products, public.dapp_transfers, public.dapp_claims, public.dapp_ownership_events, public.dapp_service_records from public, anon, authenticated;
grant all on public.dapp_profiles, public.dapp_products, public.dapp_transfers, public.dapp_claims, public.dapp_ownership_events, public.dapp_service_records to service_role;

create or replace function public.dapp_complete_onboarding(p_user_id uuid,p_wallet_address text,p_display_name text,p_role text,p_organization_name text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_profile public.dapp_profiles;
begin
  if p_wallet_address is null or lower(p_wallet_address) !~ '^0x[0-9a-f]{40}$' then raise exception 'INVALID_INPUT: Invalid wallet address'; end if;
  select * into v_profile from dapp_profiles where id = p_user_id;
  if found then
    if v_profile.wallet_address <> lower(p_wallet_address) then raise exception 'FORBIDDEN: Wallet does not match the existing profile'; end if;
    return to_jsonb(v_profile);
  end if;
  if p_role is null or p_role not in ('manufacturer','retailer','customer','service_center') or p_display_name is null or length(btrim(p_display_name)) not between 1 and 80 then raise exception 'INVALID_INPUT: Complete the required profile fields'; end if;
  if p_role <> 'customer' and (p_organization_name is null or length(btrim(p_organization_name)) not between 1 and 120) then raise exception 'INVALID_INPUT: Organization name is required for this role'; end if;
  insert into dapp_profiles(id,wallet_address,display_name,role,organization_name)
    values(p_user_id,lower(p_wallet_address),btrim(p_display_name),p_role,nullif(btrim(p_organization_name),'')) on conflict(id) do nothing;
  select * into v_profile from dapp_profiles where id = p_user_id;
  if v_profile.wallet_address <> lower(p_wallet_address) then raise exception 'FORBIDDEN: Wallet does not match the existing profile'; end if;
  return to_jsonb(v_profile);
exception when unique_violation then raise exception 'CONFLICT: This wallet is already registered';
end; $$;

create or replace function public.dapp_update_profile(p_user_id uuid,p_display_name text,p_organization_name text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_profile public.dapp_profiles;
begin
  select * into v_profile from dapp_profiles where id=p_user_id for update;
  if not found then raise exception 'NOT_FOUND: Profile not found'; end if;
  if p_display_name is null or length(btrim(p_display_name)) not between 1 and 80 then raise exception 'INVALID_INPUT: Display name is required'; end if;
  if v_profile.role <> 'customer' and (p_organization_name is null or length(btrim(p_organization_name)) not between 1 and 120) then raise exception 'INVALID_INPUT: Organization name is required for this role'; end if;
  update dapp_profiles set display_name=btrim(p_display_name),organization_name=nullif(btrim(p_organization_name),'') where id=p_user_id returning * into v_profile;
  return to_jsonb(v_profile);
end; $$;

create or replace function public.dapp_register_product(p_actor_id uuid,p_serial_number text,p_model text,p_warranty_duration_days integer,p_max_claims integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor public.dapp_profiles; v_product public.dapp_products;
begin
  select * into v_actor from dapp_profiles where id=p_actor_id;
  if not found or v_actor.role <> 'manufacturer' then raise exception 'FORBIDDEN: Only manufacturers can register products'; end if;
  if p_serial_number is null or length(btrim(p_serial_number)) not between 1 and 120 or p_model is null or length(btrim(p_model)) not between 1 and 120 or p_warranty_duration_days is null or p_warranty_duration_days not between 1 and 36500 or p_max_claims is null or p_max_claims not between 1 and 1000 then raise exception 'INVALID_INPUT: Invalid product or warranty details'; end if;
  insert into dapp_products(serial_number,model,manufacturer_id,manufacturer_name,manufacturer_wallet,owner_id,owner_wallet,warranty_duration_days,max_claims)
    values(btrim(p_serial_number),btrim(p_model),v_actor.id,coalesce(v_actor.organization_name,v_actor.display_name),v_actor.wallet_address,v_actor.id,v_actor.wallet_address,p_warranty_duration_days,p_max_claims)
    returning * into v_product;
  insert into dapp_ownership_events(product_id,to_wallet,kind) values(v_product.id,v_actor.wallet_address,'registered');
  return to_jsonb(v_product);
exception when unique_violation then raise exception 'CONFLICT: A product with this serial number already exists';
end; $$;

create or replace function public.dapp_request_transfer(p_actor_id uuid,p_product_id uuid,p_to_wallet text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor public.dapp_profiles; v_receiver public.dapp_profiles; v_product public.dapp_products; v_transfer public.dapp_transfers;
begin
  select * into v_product from dapp_products where id=p_product_id for update;
  if not found then raise exception 'NOT_FOUND: Product not found'; end if;
  if v_product.owner_id is distinct from p_actor_id then raise exception 'FORBIDDEN: Only the current owner can transfer this product'; end if;
  select * into v_actor from dapp_profiles where id=p_actor_id;
  select * into v_receiver from dapp_profiles where wallet_address=lower(btrim(p_to_wallet));
  if not found then raise exception 'INVALID_INPUT: The recipient must sign in and complete their profile first'; end if;
  if v_receiver.id=p_actor_id then raise exception 'INVALID_INPUT: Choose a different recipient'; end if;
  if not ((v_actor.role='manufacturer' and v_receiver.role='retailer') or (v_actor.role='retailer' and v_receiver.role='customer') or (v_actor.role='customer' and v_receiver.role='customer')) then raise exception 'INVALID_INPUT: Transfers follow manufacturer to retailer, retailer to customer, or customer to customer'; end if;
  if exists(select 1 from dapp_claims where product_id=p_product_id and status in ('submitted','approved')) then raise exception 'CONFLICT: Finish the open warranty claim before transferring'; end if;
  select * into v_transfer from dapp_transfers where product_id=p_product_id and status='pending';
  if found then
    if v_transfer.from_user_id=p_actor_id and v_transfer.to_user_id=v_receiver.id then return to_jsonb(v_transfer); end if;
    raise exception 'CONFLICT: A transfer is already awaiting confirmation';
  end if;
  insert into dapp_transfers(product_id,from_user_id,to_user_id,from_wallet,to_wallet)
    values(p_product_id,p_actor_id,v_receiver.id,v_actor.wallet_address,v_receiver.wallet_address) returning * into v_transfer;
  return to_jsonb(v_transfer);
end; $$;

create or replace function public.dapp_transfer_action(p_actor_id uuid,p_transfer_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_transfer public.dapp_transfers; v_product public.dapp_products; v_from public.dapp_profiles; v_to public.dapp_profiles; v_product_id uuid; v_result text; v_now timestamptz := clock_timestamp();
begin
  if p_action is null or p_action not in ('accept','reject','cancel') then raise exception 'INVALID_INPUT: Invalid transfer action'; end if;
  select product_id into v_product_id from dapp_transfers where id=p_transfer_id;
  if not found then raise exception 'NOT_FOUND: Transfer not found'; end if;
  select * into v_product from dapp_products where id=v_product_id for update;
  select * into v_transfer from dapp_transfers where id=p_transfer_id for update;
  if (p_action='cancel' and v_transfer.from_user_id is distinct from p_actor_id) or (p_action in ('accept','reject') and v_transfer.to_user_id is distinct from p_actor_id) then raise exception 'FORBIDDEN: You cannot perform this transfer action'; end if;
  v_result := case p_action when 'accept' then 'accepted' when 'reject' then 'rejected' else 'cancelled' end;
  if v_transfer.status=v_result then return to_jsonb(v_transfer); end if;
  if v_transfer.status<>'pending' then raise exception 'CONFLICT: This transfer has already been resolved'; end if;
  if v_product.owner_id <> v_transfer.from_user_id then raise exception 'CONFLICT: The sender no longer owns this product'; end if;
  if exists(select 1 from dapp_claims where product_id=v_product_id and status in ('submitted','approved')) then raise exception 'CONFLICT: Finish the open warranty claim before transferring'; end if;
  v_now := clock_timestamp();
  if p_action='accept' then
    select * into v_from from dapp_profiles where id=v_transfer.from_user_id;
    select * into v_to from dapp_profiles where id=v_transfer.to_user_id;
    update dapp_products set owner_id=v_to.id,owner_wallet=v_to.wallet_address,
      warranty_started_at=case when warranty_started_at is null and v_from.role='retailer' and v_to.role='customer' then v_now else warranty_started_at end,
      warranty_expires_at=case when warranty_started_at is null and v_from.role='retailer' and v_to.role='customer' then v_now + make_interval(days=>warranty_duration_days) else warranty_expires_at end
      where id=v_product_id;
    insert into dapp_ownership_events(product_id,from_wallet,to_wallet,kind,created_at) values(v_product_id,v_transfer.from_wallet,v_transfer.to_wallet,'transferred',v_now);
  end if;
  update dapp_transfers set status=v_result,resolved_at=v_now where id=p_transfer_id returning * into v_transfer;
  return to_jsonb(v_transfer);
end; $$;

create or replace function public.dapp_submit_claim(p_actor_id uuid,p_product_id uuid,p_service_center_id uuid,p_description text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor public.dapp_profiles; v_center public.dapp_profiles; v_product public.dapp_products; v_claim public.dapp_claims;
begin
  select * into v_product from dapp_products where id=p_product_id for update;
  if not found then raise exception 'NOT_FOUND: Product not found'; end if;
  select * into v_actor from dapp_profiles where id=p_actor_id;
  if v_product.owner_id is distinct from p_actor_id or v_actor.role is distinct from 'customer' then raise exception 'FORBIDDEN: Only the current customer owner can request warranty service'; end if;
  if exists(select 1 from dapp_transfers where product_id=p_product_id and status='pending') then raise exception 'CONFLICT: Resolve the pending transfer before requesting service'; end if;
  if exists(select 1 from dapp_claims where product_id=p_product_id and status in ('submitted','approved')) then raise exception 'CONFLICT: A warranty claim is already open'; end if;
  if v_product.warranty_started_at is null then raise exception 'WARRANTY_UNAVAILABLE: Warranty starts at the first retail sale'; end if;
  if clock_timestamp() >= v_product.warranty_expires_at then raise exception 'WARRANTY_UNAVAILABLE: The warranty has expired'; end if;
  if v_product.claims_used>=v_product.max_claims then raise exception 'WARRANTY_UNAVAILABLE: All warranty claims have been used'; end if;
  select * into v_center from dapp_profiles where id=p_service_center_id and role='service_center';
  if not found then raise exception 'INVALID_INPUT: Choose a registered service center'; end if;
  if p_description is null or length(btrim(p_description)) not between 1 and 2000 then raise exception 'INVALID_INPUT: Describe the problem in 1 to 2000 characters'; end if;
  insert into dapp_claims(product_id,customer_id,service_center_id,description) values(p_product_id,p_actor_id,p_service_center_id,btrim(p_description)) returning * into v_claim;
  return to_jsonb(v_claim);
end; $$;

create or replace function public.dapp_claim_action(p_actor_id uuid,p_claim_id uuid,p_action text,p_reason text default null,p_resolution text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_claim public.dapp_claims; v_product public.dapp_products; v_product_id uuid; v_result text; v_now timestamptz := clock_timestamp();
begin
  if p_action is null or p_action not in ('approve','reject','complete') then raise exception 'INVALID_INPUT: Invalid claim action'; end if;
  select product_id into v_product_id from dapp_claims where id=p_claim_id;
  if not found then raise exception 'NOT_FOUND: Claim not found'; end if;
  select * into v_product from dapp_products where id=v_product_id for update;
  select * into v_claim from dapp_claims where id=p_claim_id for update;
  if v_claim.service_center_id is distinct from p_actor_id or not exists(select 1 from dapp_profiles where id=p_actor_id and role='service_center') then raise exception 'FORBIDDEN: Only the assigned service center can manage this claim'; end if;
  v_result := case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'completed' end;
  if v_claim.status=v_result or (p_action='approve' and v_claim.status='completed') then return to_jsonb(v_claim); end if;
  if (p_action in ('approve','reject') and v_claim.status<>'submitted') or (p_action='complete' and v_claim.status<>'approved') then raise exception 'CONFLICT: This action does not match the current claim state'; end if;
  if p_action='reject' and (p_reason is null or length(btrim(p_reason)) not between 1 and 2000) then raise exception 'INVALID_INPUT: Explain why the claim was rejected'; end if;
  v_now := clock_timestamp();
  if p_action='complete' then
    if p_resolution is null or length(btrim(p_resolution)) not between 1 and 2000 then raise exception 'INVALID_INPUT: Describe the completed repair'; end if;
    if v_product.claims_used>=v_product.max_claims then raise exception 'CONFLICT: All warranty claims have already been used'; end if;
    -- Entitlement was checked on submission. Passing the expiry date during
    -- review/service does not invalidate an already admitted claim.
    update dapp_products set claims_used=claims_used+1 where id=v_product_id;
    insert into dapp_service_records(product_id,claim_id,service_center_id,description,created_at) values(v_product_id,v_claim.id,p_actor_id,btrim(p_resolution),v_now);
  end if;
  update dapp_claims set status=v_result,
    decision_reason=case when p_action='reject' then btrim(p_reason) else decision_reason end,
    resolution=case when p_action='complete' then btrim(p_resolution) else resolution end,
    resolved_at=case when p_action in ('reject','complete') then v_now else resolved_at end
    where id=p_claim_id returning * into v_claim;
  return to_jsonb(v_claim);
end; $$;

-- Evaluate ownership and claim participation in the same statement/snapshot as
-- the private records. Do not trust an earlier application-side owner read.
create or replace function public.dapp_visible_service_records(p_actor_id uuid,p_product_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'product_id',s.product_id,'claim_id',s.claim_id,
    'service_center_id',s.service_center_id,'description',s.description,'created_at',s.created_at
  ) order by s.created_at desc,s.id),'[]'::jsonb)
  from dapp_service_records s
  join dapp_products p on p.id=s.product_id
  join dapp_claims c on c.id=s.claim_id and c.product_id=s.product_id
  where s.product_id=p_product_id
    and (p.owner_id=p_actor_id or c.customer_id=p_actor_id or c.service_center_id=p_actor_id);
$$;

revoke all on function public.dapp_complete_onboarding(uuid,text,text,text,text),public.dapp_update_profile(uuid,text,text),public.dapp_register_product(uuid,text,text,integer,integer),public.dapp_request_transfer(uuid,uuid,text),public.dapp_transfer_action(uuid,uuid,text),public.dapp_submit_claim(uuid,uuid,uuid,text),public.dapp_claim_action(uuid,uuid,text,text,text),public.dapp_visible_service_records(uuid,uuid) from public, anon, authenticated;
grant execute on function public.dapp_complete_onboarding(uuid,text,text,text,text),public.dapp_update_profile(uuid,text,text),public.dapp_register_product(uuid,text,text,integer,integer),public.dapp_request_transfer(uuid,uuid,text),public.dapp_transfer_action(uuid,uuid,text),public.dapp_submit_claim(uuid,uuid,uuid,text),public.dapp_claim_action(uuid,uuid,text,text,text),public.dapp_visible_service_records(uuid,uuid) to service_role;

notify pgrst, 'reload schema';
