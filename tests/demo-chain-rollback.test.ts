import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

const readSql = (path: string) =>
  readFile(new URL(`../supabase/${path}`, import.meta.url), "utf8");
const install = () => readSql("migrations/202610160001_demo_chain.sql");
const uninstall = () => readSql("rollback/202610160001_demo_chain.sql");

async function existingDatabase() {
  const pg = new PGlite();
  await pg.exec(
    "create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;",
  );
  await pg.exec(await readSql("migrations/202610140001_initial.sql"));
  await pg.exec(`
    do $$
    declare
      maker uuid := '10000000-0000-4000-8000-000000000001';
      retailer uuid := '10000000-0000-4000-8000-000000000002';
      buyer uuid := '10000000-0000-4000-8000-000000000003';
      center uuid := '10000000-0000-4000-8000-000000000004';
      product uuid; transfer uuid; claim uuid;
    begin
      insert into auth.users values(maker),(retailer),(buyer),(center);
      perform dapp_complete_onboarding(maker,'0x1111111111111111111111111111111111111111','Maker','manufacturer','Maker Ltd');
      perform dapp_complete_onboarding(retailer,'0x2222222222222222222222222222222222222222','Retailer','retailer','Shop');
      perform dapp_complete_onboarding(buyer,'0x3333333333333333333333333333333333333333','Buyer','customer',null);
      perform dapp_complete_onboarding(center,'0x4444444444444444444444444444444444444444','Center','service_center','Repair Ltd');
      product := (dapp_register_product(maker,'KEEP-001','Keep this product',365,3)->>'id')::uuid;
      transfer := (dapp_request_transfer(maker,product,'0x2222222222222222222222222222222222222222')->>'id')::uuid;
      perform dapp_transfer_action(retailer,transfer,'accept');
      transfer := (dapp_request_transfer(retailer,product,'0x3333333333333333333333333333333333333333')->>'id')::uuid;
      perform dapp_transfer_action(buyer,transfer,'accept');
      claim := (dapp_submit_claim(buyer,product,center,'Keep the repair request')->>'id')::uuid;
      perform dapp_claim_action(center,claim,'approve');
      perform dapp_claim_action(center,claim,'complete',null,'Keep the completed repair');
    end $$;
    -- Namespace sentinels only; these are not the teammate's actual migration.
    create table public.dapp_chain_events(id integer primary key, evidence text);
    create table public.dapp_chain_sync(id integer primary key, next_block bigint);
    insert into public.dapp_chain_events values(1,'Keep the teammate event');
    insert into public.dapp_chain_sync values(1,42);
    alter table public.dapp_chain_events enable row level security;
    revoke all on public.dapp_chain_events,public.dapp_chain_sync from public,anon,authenticated;
    grant all on public.dapp_chain_events,public.dapp_chain_sync to service_role;
    create function public.dapp_chain_apply_event(jsonb) returns jsonb
      language sql as $$ select $1 $$;
    revoke all on function public.dapp_chain_apply_event(jsonb) from public,anon,authenticated;
    grant execute on function public.dapp_chain_apply_event(jsonb) to service_role;
    alter table public.dapp_products add column chain_id bigint default 123;
  `);
  return pg;
}

async function snapshot(pg: PGlite) {
  const queries = [
    `select table_name,column_name,data_type,is_nullable,column_default
      from information_schema.columns where table_schema='public'
      order by table_name,ordinal_position`,
    `select c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','v') order by c.relname`,
    `select p.proname,pg_get_functiondef(p.oid) definition,p.proacl::text
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' order by p.proname,pg_get_function_identity_arguments(p.oid)`,
    `select * from pg_catalog.pg_indexes where schemaname='public' order by indexname`,
    `select * from pg_catalog.pg_policies where schemaname='public' order by tablename,policyname`,
  ];
  const tables = await pg.query<{ tablename: string }>(
    "select tablename from pg_catalog.pg_tables where schemaname='public' order by tablename",
  );
  for (const { tablename } of tables.rows)
    queries.push(`select to_jsonb(t) row from public."${tablename}" t order by to_jsonb(t)::text`);
  const results = [];
  for (const query of queries) results.push((await pg.query(query)).rows);
  return results;
}

it("uninstalls an empty demo without altering existing data or RPCs, then reinstalls with all seven checks passing", async () => {
  const pg = await existingDatabase();
  try {
    const before = await snapshot(pg);
    await pg.exec(await install());
    await pg.exec(await uninstall());
    expect(await snapshot(pg)).toEqual(before);
    expect(
      (await pg.query("select dapp_chain_apply_event('{\"preserved\":true}') result")).rows,
    ).toEqual([{ result: { preserved: true } }]);
    await pg.exec(await install());
    const audit = await pg.query<{ ok: boolean }>(await readSql("checks/verify_demo_chain.sql"));
    expect(audit.rows).toHaveLength(7);
    expect(audit.rows.every((row) => row.ok)).toBe(true);
  } finally {
    await pg.close();
  }
}, 30000);

const populatedTables = [
  ["dapp_demo_chain_events", `insert into public.dapp_demo_chain_events
    values(11155111,'0x${"a".repeat(40)}',1,'0x${"b".repeat(64)}','0x${"c".repeat(64)}',0,'ProductRegistered',null,'{}')`],
  ["dapp_demo_chain_sync", `insert into public.dapp_demo_chain_sync(chain_id,contract_address,next_block)
    values(11155111,'0x${"a".repeat(40)}',1)`],
  ["dapp_demo_private_payloads", `insert into public.dapp_demo_private_payloads
    (chain_id,contract_address,commitment,author_wallet,product_id,claim_id,kind,body,nonce)
    values(11155111,'0x${"a".repeat(40)}','0x${"b".repeat(64)}','0x${"c".repeat(40)}',
      '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','description','Keep private text','0x${"d".repeat(64)}')`],
  ["dapp_demo_product_images", `insert into public.dapp_demo_product_images
    values(11155111,'0x${"a".repeat(40)}','20000000-0000-4000-8000-000000000001','keep/image.png')`],
];

it.each(populatedTables)("refuses to uninstall when %s has data and preserves every object", async (_table, insert) => {
  const pg = await existingDatabase();
  try {
    await pg.exec(await install());
    await pg.exec(insert);
    const before = await snapshot(pg);
    await expect(pg.exec(await uninstall())).rejects.toThrow();
    await pg.exec("rollback");
    expect(await snapshot(pg)).toEqual(before);
  } finally {
    await pg.close();
  }
}, 30000);

it("rolls back all drops when an external view depends on a demo table", async () => {
  const pg = await existingDatabase();
  try {
    await pg.exec(await install());
    await pg.exec("create view public.teammate_demo_view as select * from public.dapp_demo_product_images");
    const before = await snapshot(pg);
    await expect(pg.exec(await uninstall())).rejects.toThrow(/depend/i);
    await pg.exec("rollback");
    expect(await snapshot(pg)).toEqual(before);
    await expect(pg.query("select * from public.teammate_demo_view")).resolves.toBeDefined();
  } finally {
    await pg.close();
  }
}, 30000);

it("safely skips an uninstalled demo and tolerates repeated uninstalls", async () => {
  const pg = await existingDatabase();
  try {
    const before = await snapshot(pg);
    await pg.exec(await uninstall());
    expect(await snapshot(pg)).toEqual(before);
    await pg.exec(await install());
    await pg.exec(await uninstall());
    await pg.exec(await uninstall());
    expect(await snapshot(pg)).toEqual(before);
  } finally {
    await pg.close();
  }
}, 30000);

it("inventories all twelve objects without changing existing or installed data", async () => {
  const pg = await existingDatabase();
  try {
    const preflight = await readSql("checks/preflight_demo_chain.sql");
    const before = await snapshot(pg);
    const pending = await pg.query<{ module: string; present: boolean }>(preflight);
    expect(pending.rows).toHaveLength(12);
    expect(pending.rows.filter((row) => row.module === "base")).toHaveLength(6);
    expect(pending.rows.filter((row) => row.module === "demo")).toHaveLength(6);
    expect(pending.rows.every((row) => row.present === (row.module === "base"))).toBe(true);
    expect(await snapshot(pg)).toEqual(before);

    await pg.exec(await install());
    const installed = await snapshot(pg);
    const complete = await pg.query<{ present: boolean }>(preflight);
    expect(complete.rows).toHaveLength(12);
    expect(complete.rows.every((row) => row.present)).toBe(true);
    expect(await snapshot(pg)).toEqual(installed);
  } finally {
    await pg.close();
  }
}, 30000);

it("rehearses the actual migration with rollback and leaves installation available afterwards", async () => {
  const pg = await existingDatabase();
  try {
    const migration = await install();
    expect(migration.match(/^commit;\s*$/gim)).toHaveLength(1);
    const before = await snapshot(pg);
    await pg.exec(migration.replace(/^commit;\s*$/im, "rollback;"));
    expect(await snapshot(pg)).toEqual(before);

    await pg.exec(migration);
    const audit = await pg.query<{ ok: boolean }>(await readSql("checks/verify_demo_chain.sql"));
    expect(audit.rows).toHaveLength(7);
    expect(audit.rows.every((row) => row.ok)).toBe(true);
  } finally {
    await pg.close();
  }
}, 30000);
