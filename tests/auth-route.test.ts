import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Wallet } from "ethers";
import { mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("server-only", () => ({}));
import { getDatabase } from "../src/lib/database";
import { POST as challenge } from "../src/app/api/auth/challenge/route";
import { POST as verify } from "../src/app/api/auth/verify/route";
import { POST as logout } from "../src/app/api/auth/logout/route";
import { GET as me, PATCH as update } from "../src/app/api/me/route";
import { POST as onboard } from "../src/app/api/onboarding/route";
import { GET as list, POST as register } from "../src/app/api/products/route";
import { GET as publicVerify } from "../src/app/api/verify/route";
import { GET as detail } from "../src/app/api/products/[id]/route";
import { POST as upload } from "../src/app/api/products/[id]/image/route";
import { GET as image } from "../src/app/api/images/[productId]/[filename]/route";
import sharp from "sharp";
import { readdirSync, unlinkSync } from "node:fs";
let dir: string;
const origin = "http://localhost:3000";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dapp-routes-test-"));
  vi.stubEnv("LOCAL_DATABASE_PATH", join(dir, "test.sqlite"));
  vi.stubEnv("LOCAL_UPLOAD_DIR", join(dir, "uploads"));
});
afterAll(() => {
  getDatabase().close();
  // All generated files are inside our unique test directory.
  const clean = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) clean(next);
      else unlinkSync(next);
    }
    rmdirSync(path);
  };
  if (!dir.startsWith(join(tmpdir(), "dapp-routes-test-")))
    throw Error("Unexpected cleanup directory");
  clean(dir);
  vi.unstubAllEnvs();
});
function req(path: string, method = "GET", body?: unknown, cookies = "") {
  return new Request(origin + "/api/" + path, {
    method,
    headers: { origin, "content-type": "application/json", cookie: cookies },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function readCookie(r: Response, name: string) {
  const item = r.headers.getSetCookie().find((c) => c.startsWith(name + "="));
  return item?.split(";")[0] || "";
}
async function login(role = "customer") {
  const wallet = Wallet.createRandom();
  const c = await challenge(
    req("auth/challenge", "POST", {
      wallet_address: wallet.address,
      chain_id: 31337,
    }),
  );
  expect(c.status).toBe(200);
  const data = (await c.json()).data;
  const signature = await wallet.signMessage(data.message);
  const v = await verify(
    req(
      "auth/verify",
      "POST",
      { id: data.id, signature },
      readCookie(c, "dapp_challenge"),
    ),
  );
  expect(v.status).toBe(200);
  expect(v.headers.get("set-cookie")).toContain("HttpOnly");
  const session = readCookie(v, "dapp_session");
  const o = await onboard(
    req(
      "onboarding",
      "POST",
      {
        display_name: "Local tester",
        role,
        organization_name: role === "customer" ? null : "Local Manufacturer",
      },
      session,
    ),
  );
  expect(o.status).toBe(200);
  return { wallet, session, profile: (await o.json()).data };
}
it("authenticates real signatures through actual routes, restores cookie session and revokes on logout", async () => {
  expect((await me(req("me"))).status).toBe(401);
  const { session, wallet } = await login();
  const r = await me(req("me", "GET", undefined, session));
  expect(r.status).toBe(200);
  expect((await r.json()).data.wallet_address).toBe(
    wallet.address.toLowerCase(),
  );
  expect(r.headers.get("cache-control")).toContain("no-store");
  expect(
    (await logout(req("auth/logout", "POST", undefined, session))).status,
  ).toBe(200);
  expect((await me(req("me", "GET", undefined, session))).status).toBe(401);
});
it("rejects challenge replay, forged signatures and cross-origin auth requests", async () => {
  const wallet = Wallet.createRandom();
  const c = await challenge(
    req("auth/challenge", "POST", {
      wallet_address: wallet.address,
      chain_id: 1,
    }),
  );
  const data = (await c.json()).data;
  expect(
    (
      await verify(
        req(
          "auth/verify",
          "POST",
          { id: data.id, signature: "0x" + "0".repeat(130) },
          readCookie(c, "dapp_challenge"),
        ),
      )
    ).status,
  ).toBe(401);
  const signature = await wallet.signMessage(data.message);
  const signedRequest = () =>
    req(
      "auth/verify",
      "POST",
      { id: data.id, signature },
      readCookie(c, "dapp_challenge"),
    );
  expect((await verify(signedRequest())).status).toBe(200);
  expect((await verify(signedRequest())).status).toBe(401);
  const foreign = new Request(origin + "/api/auth/challenge", {
    method: "POST",
    headers: {
      origin: "https://other.example",
      "content-type": "application/json",
    },
    body: "{}",
  });
  expect((await challenge(foreign)).status).toBe(403);
});
it("routes enforce manufacturer authorization, strict input, serial uniqueness and public privacy", async () => {
  const customer = await login();
  const input = {
    serial_number: "ROUTE-001",
    model: "Route Watch",
    warranty_duration_days: 365,
    max_claims: 2,
  };
  expect(
    (await register(req("products", "POST", input, customer.session))).status,
  ).toBe(403);
  const maker = await login("manufacturer");
  const r = await register(req("products", "POST", input, maker.session));
  expect(r.status).toBe(201);
  const p = (await r.json()).data;
  expect(
    (
      await register(
        req(
          "products",
          "POST",
          { ...input, serial_number: "route-001" },
          maker.session,
        ),
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await register(
        req(
          "products",
          "POST",
          { ...input, serial_number: "Other", owner_id: customer.profile.id },
          maker.session,
        ),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await update(
        req("me", "PATCH", { role: "manufacturer" }, customer.session),
      )
    ).status,
  ).toBe(400);
  expect(
    (await detail(req(`products/${p.id}`, "GET", undefined, customer.session)))
      .status,
  ).toBe(404);
  const pub = await publicVerify(req(`verify?query=${p.id}`));
  expect(pub.status).toBe(200);
  expect(JSON.stringify(await pub.json())).not.toContain(
    maker.wallet.address.toLowerCase(),
  );
  expect((await publicVerify(req("verify?query="))).status).toBe(400);
  expect(
    (await list(req("products", "GET", undefined, maker.session))).status,
  ).toBe(200);
});
it("uploads actual normalized files locally, serves public WebP, replaces image, and denies invalid content", async () => {
  const maker = await login("manufacturer"),
    customer = await login();
  const p = (
    await (
      await register(
        req(
          "products",
          "POST",
          {
            serial_number: "IMAGE-001",
            model: "Image Watch",
            warranty_duration_days: 365,
            max_claims: 2,
          },
          maker.session,
        ),
      )
    ).json()
  ).data;
  const bytes = await sharp({
    create: {
      width: 20,
      height: 10,
      channels: 4,
      background: { r: 20, g: 80, b: 100, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  const post = async (data: Buffer, session = maker.session) => {
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array(data)], "test.png", { type: "image/png" }),
    );
    return upload(
      new Request(origin + `/api/products/${p.id}/image`, {
        method: "POST",
        headers: { origin, cookie: session },
        body: form,
      }),
      { params: Promise.resolve({ id: p.id }) },
    );
  };
  expect((await post(bytes, customer.session)).status).toBe(403);
  expect((await post(Buffer.from("not an image"))).status).toBe(400);
  const first = await post(bytes);
  expect(first.status).toBe(200);
  const firstPath = (await first.json()).data.image_path;
  const get = async (path: string) =>
    image(req("images"), {
      params: Promise.resolve({
        productId: p.id,
        filename: path.split("/").at(-1)!,
      }),
    });
  const read = await get(firstPath);
  expect(read.status).toBe(200);
  expect(read.headers.get("content-type")).toBe("image/webp");
  expect(
    (await sharp(Buffer.from(await read.arrayBuffer())).metadata()).format,
  ).toBe("webp");
  const next = (await (await post(bytes)).json()).data.image_path;
  expect(next).not.toBe(firstPath);
  expect((await get(firstPath)).status).toBe(404);
  expect((await get(next)).status).toBe(200);
  expect(
    (
      await image(req("images"), {
        params: Promise.resolve({ productId: "..", filename: "secret.env" }),
      })
    ).status,
  ).toBe(404);
});
