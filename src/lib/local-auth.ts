import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getAddress, verifyMessage } from "ethers";
import { ApiError } from "./http";
import type { LocalDatabase } from "./database";
export const SESSION_COOKIE = "dapp_session";
export const CHALLENGE_COOKIE = "dapp_challenge";
export const SESSION_SECONDS = 86400;
export const CHALLENGE_SECONDS = 300;
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function cookie(request: Request, name: string) {
  const match = (request.headers.get("cookie") || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + "="));
  const value = match?.slice(name.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export function setAuthCookie(
  response: Response,
  name: string,
  token: string,
  seconds: number,
  origin: string,
) {
  response.headers.append(
    "Set-Cookie",
    `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${origin.startsWith("https://") ? "; Secure" : ""}`,
  );
}
export function issueChallenge(
  db: LocalDatabase,
  wallet: string,
  chainId: number,
  origin: string,
) {
  const address = getAddress(wallet),
    id = randomUUID(),
    binding = randomBytes(32).toString("hex");
  const now = db.clock(),
    expiry = now + CHALLENGE_SECONDS * 1000;
  const message = `${new URL(origin).host} wants you to sign in with your Ethereum account:\n${address}\n\nSign in to your local product passport. This does not send a transaction.\n\nURI: ${origin}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${randomBytes(16).toString("hex")}\nIssued At: ${new Date(now).toISOString()}\nExpiration Time: ${new Date(expiry).toISOString()}`;
  db.transaction(() => {
    db.run("DELETE FROM challenges WHERE expires_at<=?", now);
    db.run("DELETE FROM sessions WHERE expires_at<=?", now);
    if (
      db.get<{ count: number }>(
        "SELECT count(*) AS count FROM challenges WHERE wallet_address=?",
        address.toLowerCase(),
      )!.count >= 20
    )
      throw new ApiError(
        429,
        "TOO_MANY_REQUESTS",
        "Too many login attempts. Wait five minutes and try again.",
      );
    db.run(
      "INSERT INTO challenges VALUES(?,?,?,?,?,?)",
      id,
      address.toLowerCase(),
      origin,
      message,
      hashToken(binding),
      expiry,
    );
  });
  return { id, message, binding };
}
export function verifyChallenge(
  db: LocalDatabase,
  id: string,
  signature: string,
  binding: string | null,
  origin: string,
  previousToken?: string | null,
) {
  return db.transaction(() => {
    const challenge = db.get<{
      wallet_address: string;
      origin: string;
      message: string;
      binding_hash: string;
      expires_at: number;
    }>("SELECT * FROM challenges WHERE id=?", id);
    if (
      !binding ||
      !challenge ||
      challenge.expires_at <= db.clock() ||
      challenge.origin !== origin ||
      challenge.binding_hash !== hashToken(binding)
    )
      throw new ApiError(
        401,
        "INVALID_CHALLENGE",
        "This login request expired or belongs to another browser. Connect again.",
      );
    let recovered: string;
    try {
      recovered = verifyMessage(challenge.message, signature).toLowerCase();
    } catch {
      throw new ApiError(
        401,
        "INVALID_SIGNATURE",
        "The wallet signature could not be verified.",
      );
    }
    if (recovered !== challenge.wallet_address)
      throw new ApiError(
        401,
        "INVALID_SIGNATURE",
        "The signature does not match this wallet.",
      );
    db.run("DELETE FROM challenges WHERE id=?", id);
    db.run(
      "INSERT INTO accounts(id,wallet_address) VALUES(?,?) ON CONFLICT(wallet_address) DO NOTHING",
      randomUUID(),
      recovered,
    );
    const account = db.get<{ id: string }>(
      "SELECT id FROM accounts WHERE wallet_address=?",
      recovered,
    )!;
    if (previousToken)
      db.run(
        "DELETE FROM sessions WHERE token_hash=?",
        hashToken(previousToken),
      );
    const token = randomBytes(32).toString("hex");
    db.run(
      "INSERT INTO sessions VALUES(?,?,?)",
      hashToken(token),
      account.id,
      db.clock() + SESSION_SECONDS * 1000,
    );
    return {
      token,
      profile: db.profile(account.id),
      wallet_address: recovered,
    };
  });
}
export function sessionAccount(db: LocalDatabase, token: string | null) {
  if (!token) return null;
  return (
    db.get<{ id: string; wallet_address: string }>(
      "SELECT a.id,a.wallet_address FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?",
      hashToken(token),
      db.clock(),
    ) ?? null
  );
}
