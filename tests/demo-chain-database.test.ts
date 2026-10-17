import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { it, expect } from "vitest";

it("installs demo SQL twice, protects raw/private data, and atomically checkpoints/rebuilds", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(
      "create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;",
    );
    const sql = await readFile(
      new URL(
        "../supabase/migrations/202610160001_demo_chain.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await pg.exec(sql);
    await pg.exec(sql);
    const contract = `0x${"1".repeat(40)}`,
      hash = `0x${"2".repeat(64)}`,
      anchor = `0x${"3".repeat(64)}`;
    const event = {
      block_number: "1",
      block_hash: anchor,
      transaction_hash: hash,
      log_index: 0,
      event_name: "RoleEnrolled",
      product_id: null,
      payload: { wallet: contract, role: 1 },
    };
    const ingest = (next: number, end: number, events: unknown) =>
      pg.query<{ value: { applied: boolean } }>(
        "select public.dapp_demo_ingest_events(31337,$1,$2,$3,$4,$5::jsonb) value",
        [contract, next, end, anchor, JSON.stringify(events)],
      );
    expect((await ingest(0, 2, [event])).rows[0].value.applied).toBe(true);
    expect((await ingest(0, 2, [event])).rows[0].value.applied).toBe(false);
    expect(
      (
        await pg.query<{ n: number }>(
          "select count(*)::int n from dapp_demo_chain_events",
        )
      ).rows[0].n,
    ).toBe(1);
    await expect(
      ingest(2, 3, [{ ...event, block_number: "99" }]),
    ).rejects.toThrow("outside batch");
    expect(
      (
        await pg.query<{ next_block: number }>(
          "select next_block from dapp_demo_chain_sync",
        )
      ).rows[0].next_block,
    ).toBe(2);
    for (const role of ["anon", "authenticated"]) {
      await pg.exec(`set role ${role}`);
      try {
        for (const table of [
          "dapp_demo_chain_events",
          "dapp_demo_chain_sync",
          "dapp_demo_private_payloads",
          "dapp_demo_product_images",
        ])
          await expect(pg.query(`select * from ${table}`)).rejects.toThrow(
            "permission denied",
          );
        await expect(ingest(2, 3, [])).rejects.toThrow("permission denied");
      } finally {
        await pg.exec("reset role");
      }
    }
    const reset = await pg.query<{ ok: boolean }>(
      "select public.dapp_demo_reset_index(31337,$1,2,$2,0) ok",
      [contract, anchor],
    );
    expect(reset.rows[0].ok).toBe(true);
    expect(
      (
        await pg.query<{ n: number }>(
          "select count(*)::int n from dapp_demo_chain_events",
        )
      ).rows[0].n,
    ).toBe(0);
    expect((await ingest(0, 2, [event])).rows[0].value.applied).toBe(true);
  } finally {
    await pg.close();
  }
}, 30000);
