import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { it, expect } from "vitest";
it("runs the actual PostgreSQL migration and lifecycle/security assertions", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;",
    );
    const migration = await readFile(
      new URL(
        "../supabase/migrations/202610140001_initial.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration); // Safe to run setup twice without dropping user data.
    const tests = await readFile(
      new URL("./database-lifecycle.sql", import.meta.url),
      "utf8",
    );
    await db.exec(tests);
    const result = await db.query<{ count: number }>(
      "select count(*)::int as count from public.dapp_profiles",
    );
    expect(result.rows[0].count).toBe(0); // The scenarios roll their data back.
  } finally {
    await db.close();
  }
}, 30000);
