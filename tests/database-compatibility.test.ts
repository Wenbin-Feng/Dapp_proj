import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";

const baseTables = [
  "dapp_profiles",
  "dapp_products",
  "dapp_transfers",
  "dapp_claims",
  "dapp_ownership_events",
  "dapp_service_records",
];
const readSql = (path: string) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

// Issue #1 has no published migration. These are namespace sentinels, not its implementation.
async function addOtherNamespace(pg: PGlite) {
  for (const table of baseTables)
    await pg.exec(`alter table public.${table} add column chain_id bigint`);
  await pg.exec(`
    create table public.dapp_chain_events(id integer primary key, evidence text);
    create table public.dapp_chain_sync(id integer primary key, next_block bigint);
    insert into public.dapp_chain_events values(1,'keep this event');
    insert into public.dapp_chain_sync values(1,42);
    alter table public.dapp_chain_events enable row level security;
    revoke all on public.dapp_chain_events,public.dapp_chain_sync from public,anon,authenticated;
    grant all on public.dapp_chain_events,public.dapp_chain_sync to service_role;
    create function public.dapp_chain_apply_event(jsonb) returns jsonb
      language sql as $$ select $1 $$;
    revoke all on function public.dapp_chain_apply_event(jsonb) from public,anon,authenticated;
    grant execute on function public.dapp_chain_apply_event(jsonb) to service_role;
    update public.dapp_products set chain_id=123;
  `);
}

async function snapshotExisting(pg: PGlite) {
  const queries = [
    `select table_name,column_name,data_type,is_nullable,column_default
      from information_schema.columns where table_schema='public'
      and table_name not like 'dapp_demo_%' order by table_name,ordinal_position`,
    `select c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and c.relname not like 'dapp_demo_%'
      order by c.relname`,
    `select p.proname,pg_get_functiondef(p.oid) definition,p.proacl::text
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname not like 'dapp_demo_%' order by p.oid`,
    `select * from pg_catalog.pg_indexes where schemaname='public'
      and tablename not like 'dapp_demo_%' order by indexname`,
    `select * from pg_catalog.pg_policies where schemaname='public'
      and tablename not like 'dapp_demo_%' order by tablename,policyname`,
    ...[...baseTables, "dapp_chain_events", "dapp_chain_sync"].map(
      (table) => `select to_jsonb(t) row from public.${table} t order by id`,
    ),
  ];
  const results = [];
  for (const query of queries) results.push((await pg.query(query)).rows);
  return results;
}

it.each(["before", "after"])(
  "preserves the business schema and issue #1 namespace installed %s demo SQL",
  async (order) => {
    const pg = new PGlite();
    try {
      await pg.exec(
        "create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;",
      );
      await pg.exec(await readSql("supabase/migrations/202610140001_initial.sql"));
      const actor = randomUUID();
      await pg.query("insert into auth.users values($1)", [actor]);
      await pg.query(
        "select dapp_complete_onboarding($1,$2,'Compatibility manufacturer','manufacturer','Compatibility Ltd')",
        [actor, `0x${"a".repeat(40)}`],
      );
      await pg.query(
        "select dapp_register_product($1,'COMPAT-KEEP','Existing product',365,3)",
        [actor],
      );
      const demo = await readSql("supabase/migrations/202610160001_demo_chain.sql");
      const audit = await readSql("supabase/checks/verify_demo_chain.sql");
      const pending = await pg.query<{ ok: boolean }>(audit);
      expect(pending.rows.filter((row) => !row.ok)).toHaveLength(6);
      if (order === "after") await pg.exec(demo);
      await addOtherNamespace(pg);
      const before = await snapshotExisting(pg);
      await pg.exec(demo);
      await pg.exec(demo);
      expect(await snapshotExisting(pg)).toEqual(before);
      const installed = await pg.query<{ ok: boolean }>(audit);
      expect(installed.rows).toHaveLength(7);
      expect(installed.rows.every((row) => row.ok)).toBe(true);
      await pg.exec(await readSql("tests/database-lifecycle.sql"));
      expect(await snapshotExisting(pg)).toEqual(before);
      expect(
        (await pg.query("select dapp_chain_apply_event('{\"sentinel\":true}') result")).rows,
      ).toEqual([{ result: { sentinel: true } }]);
    } finally {
      await pg.close();
    }
  },
  30000,
);

it("reports missing columns and unsafe/incomplete privileges without changing the database", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(
      "create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;",
    );
    await pg.exec(await readSql("supabase/migrations/202610140001_initial.sql"));
    await pg.exec(await readSql("supabase/migrations/202610160001_demo_chain.sql"));
    const audit = await readSql("supabase/checks/verify_demo_chain.sql");
    for (const mutation of [
      "grant select on public.dapp_demo_private_payloads to anon",
      "revoke insert on public.dapp_demo_chain_events from service_role",
      "grant execute on function public.dapp_demo_reset_index(integer,text,bigint,text,bigint) to authenticated",
      "alter table public.dapp_demo_chain_sync disable row level security",
      "alter table public.dapp_demo_private_payloads drop column body",
    ]) {
      await pg.exec(`begin; ${mutation};`);
      try {
        const result = await pg.query<{ ok: boolean }>(audit);
        expect(result.rows.filter((row) => !row.ok), mutation).toHaveLength(1);
        await expect(
          pg.exec(`set transaction read only; ${audit}`),
        ).resolves.toBeDefined();
      } finally {
        await pg.exec("rollback");
      }
    }
    expect(
      (await pg.query<{ ok: boolean }>(audit)).rows.every((row) => row.ok),
    ).toBe(true);
  } finally {
    await pg.close();
  }
}, 30000);
