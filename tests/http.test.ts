import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ApiError, route, readJson } from "../src/lib/http";
describe("Request boundary", () => {
  beforeEach(() => vi.stubEnv("VERCEL", undefined));
  afterEach(() => vi.unstubAllEnvs());
  const handler = route(async () => Response.json({ data: "ok" }));
  it("rejects cross-origin and missing-origin writes", async () => {
    for (const origin of ["https://attacker.example", null]) {
      const response = await handler(
        new Request("http://localhost:3000/api/test", {
          method: "POST",
          headers: origin ? { origin } : {},
        }),
      );
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("INVALID_ORIGIN");
    }
  });
  it("allows same-origin writes and marks responses uncacheable", async () => {
    const response = await handler(
      new Request("http://localhost:3000/api/test", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
  it("accepts the browser host when Next uses its internal bind address", async () => {
    const response = await handler(
      new Request("http://0.0.0.0:3000/api/test", {
        method: "POST",
        headers: { host: "localhost:3000", origin: "http://localhost:3000" },
      }),
    );
    expect(response.status).toBe(200);
  });
  it("accepts HTTPS from the trusted Vercel proxy over an internal HTTP URL", async () => {
    vi.stubEnv("VERCEL", "1");
    const response = await handler(
      new Request("http://internal.vercel:3000/api/test", {
        method: "POST",
        headers: {
          host: "app.vercel.app",
          "x-forwarded-proto": "https",
          origin: "https://app.vercel.app",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
  it("ignores a forged proxy protocol outside Vercel", async () => {
    const response = await handler(
      new Request("http://internal.local:3000/api/test", {
        method: "POST",
        headers: {
          host: "app.vercel.app",
          "x-forwarded-proto": "https",
          origin: "https://app.vercel.app",
        },
      }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("INVALID_ORIGIN");
  });
  it("does not trust a forwarded host, even on Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    const response = await handler(
      new Request("http://internal.vercel:3000/api/test", {
        method: "POST",
        headers: {
          host: "app.vercel.app",
          "x-forwarded-host": "attacker.example",
          "x-forwarded-proto": "https",
          origin: "https://attacker.example",
        },
      }),
    );
    expect(response.status).toBe(403);
  });
  it("still rejects foreign, missing and cross-site origins behind Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    const scenarios: Record<string, string>[] = [
      { origin: "https://attacker.example" },
      {},
      { origin: "https://app.vercel.app", "sec-fetch-site": "cross-site" },
    ];
    for (const extra of scenarios) {
      const response = await handler(
        new Request("http://internal.vercel:3000/api/test", {
          method: "POST",
          headers: {
            host: "app.vercel.app",
            "x-forwarded-proto": "https",
            ...extra,
          },
        }),
      );
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("INVALID_ORIGIN");
    }
  });
  it.each(["ftp", "HTTPS", "https, http", ""])(
    "rejects an invalid or non-single Vercel proxy protocol: %j",
    async (protocol) => {
      vi.stubEnv("VERCEL", "1");
      const response = await handler(
        new Request("http://internal.vercel:3000/api/test", {
          method: "POST",
          headers: {
            host: "app.vercel.app",
            "x-forwarded-proto": protocol,
            origin: "http://app.vercel.app",
          },
        }),
      );
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("INVALID_ORIGIN");
    },
  );
  it("does not disclose internal error details", async () => {
    const response = await route(async () => {
      throw new Error("secret database host password");
    })(new Request("http://localhost:3000/api/test"));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("password");
  });
  it("rejects invalid JSON, oversized bodies and unexpected fields", async () => {
    const schema = z.object({ display_name: z.string() }).strict();
    const request = (body: string) =>
      new Request("http://localhost:3000/api/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
    await expect(readJson(request("{"), schema)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      readJson(
        request(JSON.stringify({ display_name: "x", role: "manufacturer" })),
        schema,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      readJson(
        request(JSON.stringify({ display_name: "x".repeat(65537) })),
        schema,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("preserves actionable application errors without caching them", async () => {
    const response = await route(async () => {
      throw new ApiError(409, "CONFLICT", "Finish the open claim first.");
    })(new Request("http://localhost:3000/api/test"));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("CONFLICT");
  });
  it("cancels an oversized streaming body without reading further chunks", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(65537));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("http://localhost:3000/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    await expect(readJson(request, z.object({}))).rejects.toMatchObject({
      status: 413,
    });
    expect(cancelled).toBe(true);
  });
});
