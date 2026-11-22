import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Wallet } from "ethers";
vi.mock("server-only", () => ({}));
import { LocalDatabase } from "../src/lib/database";
import {
  issueChallenge,
  verifyChallenge,
  sessionAccount,
  hashToken,
  cookie,
  SESSION_SECONDS,
} from "../src/lib/local-auth";
let db: LocalDatabase, now: number;
const wallet = Wallet.createRandom(),
  other = Wallet.createRandom(),
  origin = "http://localhost:3000";
beforeEach(() => {
  now = Date.now();
  db = new LocalDatabase(":memory:", () => now);
});
afterEach(() => db.close());
async function login() {
  const c = issueChallenge(db, wallet.address, 31337, origin);
  return { c, signature: await wallet.signMessage(c.message) };
}
describe("Local Ethereum signature and SQLite sessions", () => {
  it("verifies a real signature, stores only token hashes, and expires sessions", async () => {
    const { c, signature } = await login();
    const result = verifyChallenge(db, c.id, signature, c.binding, origin);
    expect(result.wallet_address).toBe(wallet.address.toLowerCase());
    expect(result.profile).toBeNull();
    expect(sessionAccount(db, result.token)?.wallet_address).toBe(
      wallet.address.toLowerCase(),
    );
    expect(
      db.get<{ token_hash: string }>("SELECT token_hash FROM sessions")!
        .token_hash,
    ).toBe(hashToken(result.token));
    now += SESSION_SECONDS * 1000;
    expect(sessionAccount(db, result.token)).toBeNull();
  });
  it("rejects signatures from another wallet and never creates its session", async () => {
    const { c } = await login();
    expect(() =>
      verifyChallenge(db, c.id, awaitSignature, c.binding, origin),
    ).toThrow();
    const signature = await other.signMessage(c.message);
    expect(() =>
      verifyChallenge(db, c.id, signature, c.binding, origin),
    ).toThrow("does not match");
    expect(db.all("SELECT * FROM sessions")).toHaveLength(0);
  });
  it("binds nonce to origin and browser, and rejects missing cookies", async () => {
    const { c, signature } = await login();
    for (const binding of [null, "0".repeat(64)])
      expect(() =>
        verifyChallenge(db, c.id, signature, binding, origin),
      ).toThrow("another browser");
    expect(() =>
      verifyChallenge(db, c.id, signature, c.binding, "http://127.0.0.1:3000"),
    ).toThrow("another browser");
  });
  it("rejects expiration at its exact boundary and replay after successful use", async () => {
    const { c, signature } = await login();
    now += 300000;
    expect(() =>
      verifyChallenge(db, c.id, signature, c.binding, origin),
    ).toThrow("expired");
    const next = await login();
    verifyChallenge(db, next.c.id, next.signature, next.c.binding, origin);
    expect(() =>
      verifyChallenge(db, next.c.id, next.signature, next.c.binding, origin),
    ).toThrow("expired");
  });
  it("revokes the prior session on login and reuses the wallet account", async () => {
    const first = await login();
    const a = verifyChallenge(
      db,
      first.c.id,
      first.signature,
      first.c.binding,
      origin,
    );
    const second = await login();
    const b = verifyChallenge(
      db,
      second.c.id,
      second.signature,
      second.c.binding,
      origin,
      a.token,
    );
    expect(sessionAccount(db, a.token)).toBeNull();
    expect(sessionAccount(db, b.token)).toBeTruthy();
    expect(db.all("SELECT * FROM accounts")).toHaveLength(1);
  });
  it("limits active challenges and permits login again after expiry", () => {
    for (let i = 0; i < 20; i++) issueChallenge(db, wallet.address, 1, origin);
    expect(() => issueChallenge(db, wallet.address, 1, origin)).toThrow(
      "Too many",
    );
    now += 300000;
    expect(() => issueChallenge(db, wallet.address, 1, origin)).not.toThrow();
  });
  it("parses only well-formed session tokens and parameterizes lookup", () => {
    expect(
      cookie(
        new Request(origin, { headers: { cookie: "dapp_session=' OR 1=1" } }),
        "dapp_session",
      ),
    ).toBeNull();
    expect(sessionAccount(db, "' OR 1=1 --")).toBeNull();
  });
});
const awaitSignature = "0x" + "0".repeat(130);
