-- The harness creates auth.users and roles, applies the migration twice, then
-- executes this real PostgreSQL scenario. All test identities/data roll back.
begin;

create function pg_temp.assert_ok(p_condition boolean,p_message text)
returns void language plpgsql as $$ begin
  if p_condition is not true then raise exception 'Assertion failed: %',p_message; end if;
end; $$;

create function pg_temp.expect_error(p_statement text,p_prefix text)
returns void language plpgsql as $$
declare v_message text;
begin
  begin
    execute p_statement;
  exception when others then
    get stacked diagnostics v_message = message_text;
    if left(v_message,length(p_prefix))=p_prefix then return; end if;
    raise exception 'Expected error %, received %',p_prefix,v_message;
  end;
  raise exception 'Expected error %, but statement succeeded',p_prefix;
end; $$;

insert into auth.users(id) values
 ('10000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002'),
 ('10000000-0000-4000-8000-000000000003'),
 ('10000000-0000-4000-8000-000000000004'),
 ('10000000-0000-4000-8000-000000000005'),
 ('10000000-0000-4000-8000-000000000006');

select dapp_complete_onboarding('10000000-0000-4000-8000-000000000001','0x1111111111111111111111111111111111111111','Maker','manufacturer','Origin Devices');
select dapp_complete_onboarding('10000000-0000-4000-8000-000000000002','0x2222222222222222222222222222222222222222','Retailer','retailer','Retail Store');
select dapp_complete_onboarding('10000000-0000-4000-8000-000000000003','0x3333333333333333333333333333333333333333','First Customer','customer',null);
select dapp_complete_onboarding('10000000-0000-4000-8000-000000000004','0x4444444444444444444444444444444444444444','Second Customer','customer',null);
select dapp_complete_onboarding('10000000-0000-4000-8000-000000000005','0x5555555555555555555555555555555555555555','Repair Center','service_center','Origin Service');
select dapp_complete_onboarding('10000000-0000-4000-8000-000000000006','0x6666666666666666666666666666666666666666','Other Center','service_center','Other Service');

do $$
declare
  maker uuid := '10000000-0000-4000-8000-000000000001';
  retailer uuid := '10000000-0000-4000-8000-000000000002';
  buyer uuid := '10000000-0000-4000-8000-000000000003';
  second_buyer uuid := '10000000-0000-4000-8000-000000000004';
  center uuid := '10000000-0000-4000-8000-000000000005';
  other_center uuid := '10000000-0000-4000-8000-000000000006';
  v_product_id uuid;
  v_transfer_id uuid;
  v_claim_id uuid;
  payload jsonb;
  start_time timestamptz;
  expiry_time timestamptz;
begin
  perform pg_temp.assert_ok(not has_table_privilege('anon','public.dapp_products','SELECT'),'anonymous cannot query business products');
  perform pg_temp.assert_ok(not has_table_privilege('authenticated','public.dapp_profiles','SELECT'),'signed-in clients cannot read private profiles directly');
  perform pg_temp.assert_ok(not has_table_privilege('authenticated','public.dapp_products','UPDATE'),'signed-in clients cannot mutate products directly');
  perform pg_temp.assert_ok(not has_function_privilege('authenticated','public.dapp_register_product(uuid,text,text,integer,integer)','EXECUTE'),'signed-in clients cannot invoke actor-parameter RPCs');
  perform pg_temp.assert_ok(not has_function_privilege('anon','public.dapp_visible_service_records(uuid,uuid)','EXECUTE'),'anonymous cannot invoke the private repair query RPC');
  perform pg_temp.assert_ok(not has_function_privilege('authenticated','public.dapp_visible_service_records(uuid,uuid)','EXECUTE'),'signed-in clients cannot supply actors to the private repair query RPC');
  perform pg_temp.assert_ok(has_function_privilege('service_role','public.dapp_register_product(uuid,text,text,integer,integer)','EXECUTE'),'backend can invoke RPCs');
  perform pg_temp.assert_ok((select bool_and(relrowsecurity) from pg_class where relname in ('dapp_profiles','dapp_products','dapp_transfers','dapp_claims','dapp_ownership_events','dapp_service_records')),'business RLS enabled');

  payload := dapp_complete_onboarding(buyer,'0x3333333333333333333333333333333333333333','Changed','manufacturer','Fake Company');
  perform pg_temp.assert_ok(payload->>'role'='customer' and payload->>'display_name'='First Customer','repeat onboarding preserves initial role and profile');
  perform pg_temp.expect_error(format('select dapp_complete_onboarding(%L,%L,%L,%L,null)',buyer,'0x4444444444444444444444444444444444444444','Mismatch','customer'),'FORBIDDEN:');
  perform pg_temp.expect_error(format('select dapp_register_product(%L,%L,%L,365,1)',buyer,'INVALID','Watch'),'FORBIDDEN:');
  payload := dapp_register_product(maker,' ORIGIN-001 ','Luxury Smartwatch',365,1);
  v_product_id := (payload->>'id')::uuid;
  perform pg_temp.assert_ok(payload->>'serial_number'='ORIGIN-001','serial trimmed');
  perform pg_temp.expect_error(format('select dapp_register_product(%L,%L,%L,365,1)',maker,'origin-001','Duplicate'),'CONFLICT:');
  perform pg_temp.assert_ok((select count(*)=1 from dapp_ownership_events where dapp_ownership_events.product_id=v_product_id),'registration has one history event');
  perform pg_temp.expect_error(format('select dapp_request_transfer(%L,%L,%L)',buyer,v_product_id,'0x4444444444444444444444444444444444444444'),'FORBIDDEN:');
  perform pg_temp.expect_error(format('select dapp_request_transfer(%L,%L,%L)',maker,v_product_id,'0x9999999999999999999999999999999999999999'),'INVALID_INPUT:');
  perform pg_temp.expect_error(format('select dapp_request_transfer(%L,%L,%L)',maker,v_product_id,'0x3333333333333333333333333333333333333333'),'INVALID_INPUT:');
  payload := dapp_request_transfer(maker,v_product_id,'0x2222222222222222222222222222222222222222');
  v_transfer_id := (payload->>'id')::uuid;
  perform pg_temp.assert_ok((dapp_request_transfer(maker,v_product_id,'0x2222222222222222222222222222222222222222')->>'id')::uuid=v_transfer_id,'repeat pending offer is idempotent');
  perform pg_temp.assert_ok((select owner_id=maker from dapp_products where id=v_product_id),'pending offer does not change ownership');
  perform pg_temp.expect_error(format('select dapp_transfer_action(%L,%L,%L)',maker,v_transfer_id,'accept'),'FORBIDDEN:');
  perform pg_temp.expect_error(format('select dapp_transfer_action(null,%L,%L)',v_transfer_id,'accept'),'FORBIDDEN:');
  perform pg_temp.expect_error(format('select dapp_transfer_action(%L,%L,%L)',retailer,v_transfer_id,'cancel'),'FORBIDDEN:');
  perform dapp_transfer_action(maker,v_transfer_id,'cancel');
  perform dapp_transfer_action(maker,v_transfer_id,'cancel');
  perform pg_temp.assert_ok((select count(*)=1 from dapp_ownership_events where dapp_ownership_events.product_id=v_product_id),'cancel produces no ownership event');
  payload := dapp_request_transfer(maker,v_product_id,'0x2222222222222222222222222222222222222222');
  v_transfer_id := (payload->>'id')::uuid;
  perform dapp_transfer_action(retailer,v_transfer_id,'accept');
  perform dapp_transfer_action(retailer,v_transfer_id,'accept');
  perform pg_temp.assert_ok((select owner_id=retailer and warranty_started_at is null from dapp_products where id=v_product_id),'manufacturer to retailer does not start warranty');
  perform pg_temp.assert_ok((select count(*)=2 from dapp_ownership_events where dapp_ownership_events.product_id=v_product_id),'repeat acceptance creates no duplicate event');
  perform pg_temp.expect_error(format('select dapp_request_transfer(%L,%L,%L)',maker,v_product_id,'0x2222222222222222222222222222222222222222'),'FORBIDDEN:');

  payload := dapp_request_transfer(retailer,v_product_id,'0x3333333333333333333333333333333333333333');
  v_transfer_id := (payload->>'id')::uuid;
  perform dapp_transfer_action(buyer,v_transfer_id,'reject');
  perform dapp_transfer_action(buyer,v_transfer_id,'reject');
  perform pg_temp.assert_ok((select owner_id=retailer and warranty_started_at is null from dapp_products where id=v_product_id),'rejected retail transfer does not start warranty');
  payload := dapp_request_transfer(retailer,v_product_id,'0x3333333333333333333333333333333333333333');
  v_transfer_id := (payload->>'id')::uuid;
  perform pg_temp.expect_error(format('select dapp_submit_claim(%L,%L,%L,%L)',buyer,v_product_id,center,'Not owner yet'),'FORBIDDEN:');
  perform dapp_transfer_action(buyer,v_transfer_id,'accept');
  select warranty_started_at,warranty_expires_at into start_time,expiry_time from dapp_products where id=v_product_id;
  perform pg_temp.assert_ok(start_time is not null and expiry_time=start_time+interval '365 days','accepted first retail sale starts warranty');

  perform pg_temp.expect_error(format('select dapp_submit_claim(%L,%L,%L,%L)',second_buyer,v_product_id,center,'Wrong owner'),'FORBIDDEN:');
  perform pg_temp.expect_error(format('select dapp_submit_claim(%L,%L,%L,%L)',buyer,v_product_id,retailer,'Wrong center'),'INVALID_INPUT:');
  payload := dapp_submit_claim(buyer,v_product_id,center,'Private battery problem');
  v_claim_id := (payload->>'id')::uuid;
  perform pg_temp.expect_error(format('select dapp_request_transfer(%L,%L,%L)',buyer,v_product_id,'0x4444444444444444444444444444444444444444'),'CONFLICT:');
  perform pg_temp.expect_error(format('select dapp_submit_claim(%L,%L,%L,%L)',buyer,v_product_id,center,'Duplicate open claim'),'CONFLICT:');
  perform pg_temp.expect_error(format('select dapp_claim_action(%L,%L,%L,null,null)',other_center,v_claim_id,'approve'),'FORBIDDEN:');
  perform pg_temp.expect_error(format('select dapp_claim_action(%L,%L,%L,null,null)',center,v_claim_id,'reject'),'INVALID_INPUT:');
  perform dapp_claim_action(center,v_claim_id,'reject','Damage outside warranty',null);
  perform dapp_claim_action(center,v_claim_id,'reject','Repeated rejection',null);
  perform pg_temp.assert_ok((select claims_used=0 from dapp_products where id=v_product_id),'rejected claims consume no entitlement');

  payload := dapp_request_transfer(buyer,v_product_id,'0x4444444444444444444444444444444444444444');
  v_transfer_id := (payload->>'id')::uuid;
  perform pg_temp.expect_error(format('select dapp_submit_claim(%L,%L,%L,%L)',buyer,v_product_id,center,'Pending transfer'),'CONFLICT:');
  perform dapp_transfer_action(buyer,v_transfer_id,'cancel');
  payload := dapp_submit_claim(buyer,v_product_id,center,'Private repair request');
  v_claim_id := (payload->>'id')::uuid;
  perform pg_temp.expect_error(format('select dapp_claim_action(%L,%L,%L,null,%L)',center,v_claim_id,'complete','Too early'),'CONFLICT:');
  perform dapp_claim_action(center,v_claim_id,'approve');
  perform dapp_claim_action(center,v_claim_id,'approve');
  perform pg_temp.assert_ok((select claims_used=0 from dapp_products where id=v_product_id),'approval does not consume a claim');
  perform pg_temp.expect_error(format('select dapp_claim_action(%L,%L,%L,%L,null)',center,v_claim_id,'reject','Too late'),'CONFLICT:');
  -- Simulate a product that expired while the admitted repair was in progress.
  update dapp_products set warranty_started_at=clock_timestamp()-interval '366 days',warranty_expires_at=clock_timestamp()-interval '1 day' where id=v_product_id;
  perform dapp_claim_action(center,v_claim_id,'complete',null,'Battery replaced');
  perform dapp_claim_action(center,v_claim_id,'complete',null,'Duplicate must not overwrite');
  perform pg_temp.assert_ok((select claims_used=1 from dapp_products where id=v_product_id),'completion consumes exactly one claim');
  perform pg_temp.assert_ok((select count(*)=1 from dapp_service_records where dapp_service_records.claim_id=v_claim_id),'completion creates exactly one service record');
  perform pg_temp.assert_ok((select resolution='Battery replaced' from dapp_claims where id=v_claim_id),'retry does not overwrite completed repair');
  perform pg_temp.expect_error(format('select dapp_submit_claim(%L,%L,%L,%L)',buyer,v_product_id,center,'Expired request'),'WARRANTY_UNAVAILABLE:');
  update dapp_products set warranty_started_at=start_time,warranty_expires_at=expiry_time where id=v_product_id;
  perform pg_temp.expect_error(format('select dapp_submit_claim(%L,%L,%L,%L)',buyer,v_product_id,center,'Exhausted request'),'WARRANTY_UNAVAILABLE:');
  payload := dapp_request_transfer(buyer,v_product_id,'0x4444444444444444444444444444444444444444');
  v_transfer_id := (payload->>'id')::uuid;
  perform dapp_transfer_action(second_buyer,v_transfer_id,'accept');
  perform pg_temp.assert_ok((select owner_id=second_buyer and warranty_started_at=start_time and warranty_expires_at=expiry_time and claims_used=1 from dapp_products where id=v_product_id),'resale inherits dates and used claims');
  perform pg_temp.assert_ok((select count(*)=4 from dapp_ownership_events where dapp_ownership_events.product_id=v_product_id),'complete manufacturer retail and resale history');
  perform pg_temp.expect_error(format('select dapp_submit_claim(%L,%L,%L,%L)',buyer,v_product_id,center,'Previous owner'),'FORBIDDEN:');
  perform pg_temp.expect_error(format('select dapp_request_transfer(%L,%L,%L)',buyer,v_product_id,'0x3333333333333333333333333333333333333333'),'FORBIDDEN:');
  perform pg_temp.expect_error(format('select dapp_submit_claim(%L,%L,%L,%L)',second_buyer,v_product_id,center,'Inherited exhausted warranty'),'WARRANTY_UNAVAILABLE:');
  -- Expand this local fixture's allowance so the new owner can add a private
  -- repair. Production API does not expose any warranty-term update operation.
  update dapp_products set max_claims=2 where id=v_product_id;
  payload := dapp_submit_claim(second_buyer,v_product_id,other_center,'New owner private issue');
  v_claim_id := (payload->>'id')::uuid;
  perform dapp_claim_action(other_center,v_claim_id,'approve');
  perform dapp_claim_action(other_center,v_claim_id,'complete',null,'New owner private repair');
  payload := dapp_visible_service_records(second_buyer,v_product_id);
  perform pg_temp.assert_ok(jsonb_array_length(payload)=2,'current owner can read all product repair records');
  payload := dapp_visible_service_records(buyer,v_product_id);
  perform pg_temp.assert_ok(jsonb_array_length(payload)=1 and payload->0->>'description'='Battery replaced','previous owner retains own repair but cannot read the new owner repair');
  payload := dapp_visible_service_records(center,v_product_id);
  perform pg_temp.assert_ok(jsonb_array_length(payload)=1 and payload->0->>'description'='Battery replaced','assigned service center reads only its own repair');
  payload := dapp_visible_service_records(other_center,v_product_id);
  perform pg_temp.assert_ok(jsonb_array_length(payload)=1 and payload->0->>'description'='New owner private repair','second center cannot read the first center repair');
  perform pg_temp.assert_ok(dapp_visible_service_records(maker,v_product_id)='[]'::jsonb,'manufacturer receives no private repairs without owner or claim participation');
  perform pg_temp.assert_ok(dapp_visible_service_records(retailer,v_product_id)='[]'::jsonb,'historical retailer receives no private repairs');
  perform pg_temp.assert_ok(dapp_visible_service_records(null,v_product_id)='[]'::jsonb,'null actor receives no private repairs');
  payload := dapp_update_profile(buyer,'Updated Name',null);
  perform pg_temp.assert_ok(payload->>'role'='customer' and payload->>'wallet_address'='0x3333333333333333333333333333333333333333','profile edits preserve identity and role');
end; $$;

rollback;
