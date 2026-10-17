import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEther, keccak256, toHex, zeroAddress } from "viem";
import { artifact, fixture } from "./helpers.mjs";

const id = (n) => `0x00000000000040008000${n.toString(16).padStart(12, "0")}`;
const commitment = (text) => keccak256(toHex(text));
async function setup() {
  const f = await fixture();
  const pdc = await f.deploy(await artifact("DemoToken"), [
    "PDC",
    "PDC",
    f.accounts[0],
  ]);
  const registry = await f.deploy(await artifact("DemoProducts"), [
    pdc.address,
  ]);
  for (const [wallet, role] of [
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 3],
    [5, 4],
  ])
    await f.send(f.wallets[wallet], registry, "enroll", [role]);
  for (const buyer of [3, 4])
    await f.send(f.wallets[0], pdc, "transfer", [
      f.accounts[buyer],
      parseEther("10000"),
    ]);
  const product = (n) => f.read(registry, "getProduct", [id(n)]);
  const register = (n, days = 365, maxClaims = 3) =>
    f.send(f.wallets[1], registry, "registerProduct", [
      id(n),
      `DEMO-${n}`,
      "Course product",
      days,
      maxClaims,
    ]);
  const free = async (transferId, productId, from, to) => {
    await f.send(f.wallets[from], registry, "requestTransfer", [
      id(transferId),
      id(productId),
      f.accounts[to],
    ]);
    await f.send(f.wallets[to], registry, "acceptTransfer", [id(transferId)]);
  };
  const expires = async (seconds = 600n) =>
    (await f.client.getBlock()).timestamp + seconds;
  return { ...f, pdc, registry, product, register, free, expires };
}

test("PDC settlement is atomic, designated, replay-safe and cannot use the free entry", async () => {
  const f = await setup();
  try {
    const { registry: r, pdc, wallets: w, accounts: a } = f;
    await assert.rejects(
      f.deploy(await artifact("DemoProducts"), [zeroAddress]),
    );
    await assert.rejects(f.send(w[1], r, "enroll", [3]));
    await f.register(1, 365, 1);
    await assert.rejects(
      f.send(w[1], r, "registerProduct", [id(20), "demo-1", "Copy", 365, 1]),
    );
    await assert.rejects(
      f.send(w[1], r, "registerProduct", [id(21), "非ASCII", "Model", 365, 1]),
    );
    await assert.rejects(
      f.send(w[1], r, "requestTransfer", [id(2), id(1), a[3]]),
    );
    await f.free(2, 1, 1, 2);
    assert.equal((await f.product(1)).warrantyStarted, 0n);
    await f.send(w[2], r, "createPaidOffer", [
      id(3),
      id(1),
      a[3],
      parseEther("100"),
      await f.expires(),
    ]);
    await assert.rejects(f.send(w[3], r, "acceptTransfer", [id(3)]));
    await assert.rejects(f.send(w[4], r, "acceptPaidOffer", [id(3)]));
    await assert.rejects(f.send(w[3], r, "acceptPaidOffer", [id(3)]));
    assert.equal((await f.product(1)).owner.toLowerCase(), a[2]);
    assert.equal((await f.product(1)).warrantyStarted, 0n);
    await f.send(w[3], pdc, "approve", [r.address, parseEther("100")]);
    await f.send(w[3], pdc, "transfer", [a[0], parseEther("9901")]);
    await assert.rejects(f.send(w[3], r, "acceptPaidOffer", [id(3)]));
    assert.equal((await f.product(1)).owner.toLowerCase(), a[2]);
    assert.equal((await f.product(1)).warrantyStarted, 0n);
    assert.equal(await f.read(pdc, "balanceOf", [a[2]]), 0n);
    assert.equal(
      await f.read(pdc, "allowance", [a[3], r.address]),
      parseEther("100"),
    );
    assert.equal((await f.read(r, "getTransfer", [id(3)])).status, 1);
    await f.send(w[0], pdc, "transfer", [a[3], parseEther("1")]);
    const receipt = await f.send(w[3], r, "acceptPaidOffer", [id(3)]);
    const product = await f.product(1);
    assert.equal(product.owner.toLowerCase(), a[3]);
    assert.equal(
      product.warrantyStarted,
      (await f.client.getBlock({ blockNumber: receipt.blockNumber })).timestamp,
    );
    assert.equal(await f.read(pdc, "balanceOf", [a[2]]), parseEther("100"));
    assert.equal(await f.read(pdc, "balanceOf", [a[3]]), 0n);
    assert.equal(await f.read(pdc, "allowance", [a[3], r.address]), 0n);
    await assert.rejects(f.send(w[3], r, "acceptPaidOffer", [id(3)]));
    await f.send(w[3], r, "submitClaim", [
      id(4),
      id(1),
      a[5],
      commitment("salted description"),
    ]);
    await assert.rejects(
      f.send(w[3], r, "createPaidOffer", [
        id(5),
        id(1),
        a[4],
        1n,
        await f.expires(),
      ]),
    );
    await assert.rejects(
      f.send(w[4], r, "completeClaim", [id(4), commitment("resolution")]),
    );
    await f.send(w[5], r, "approveClaim", [id(4)]);
    assert.equal((await f.product(1)).claimsUsed, 0);
    await f.send(w[5], r, "completeClaim", [id(4), commitment("resolution")]);
    assert.equal((await f.product(1)).claimsUsed, 1);
    await assert.rejects(
      f.send(w[5], r, "completeClaim", [id(4), commitment("again")]),
    );
    await assert.rejects(
      f.send(w[3], r, "submitClaim", [
        id(6),
        id(1),
        a[5],
        commitment("exhausted"),
      ]),
    );
    await f.send(w[3], r, "createPaidOffer", [
      id(7),
      id(1),
      a[4],
      parseEther("20"),
      await f.expires(),
    ]);
    await assert.rejects(
      f.send(w[3], r, "requestTransfer", [id(8), id(1), a[4]]),
    );
    await f.connection.provider.request({
      method: "evm_increaseTime",
      params: [601],
    });
    await f.connection.provider.request({ method: "evm_mine" });
    await assert.rejects(f.send(w[4], r, "acceptPaidOffer", [id(7)]));
    await assert.rejects(f.send(w[4], r, "cancelTransfer", [id(7)]));
    await f.send(w[3], r, "cancelTransfer", [id(7)]);
    await f.free(9, 1, 3, 4);
    assert.equal((await f.product(1)).warrantyStarted, product.warrantyStarted);
    assert.equal((await f.product(1)).claimsUsed, 1);
  } finally {
    await f.connection.close();
  }
});

test("valid claims survive expiry, rejection/approval preserve allowance and workflows exclude each other", async () => {
  const f = await setup();
  try {
    const { registry: r, wallets: w, accounts: a } = f;
    await f.register(30, 1, 2);
    await f.free(31, 30, 1, 2);
    await f.free(32, 30, 2, 3);
    await f.send(w[3], r, "requestTransfer", [id(33), id(30), a[4]]);
    await assert.rejects(
      f.send(w[3], r, "submitClaim", [
        id(34),
        id(30),
        a[5],
        commitment("open transfer"),
      ]),
    );
    await f.send(w[4], r, "rejectTransfer", [id(33)]);
    await f.send(w[3], r, "submitClaim", [
      id(34),
      id(30),
      a[5],
      commitment("private problem"),
    ]);
    await f.send(w[5], r, "rejectClaim", [id(34), commitment("reason")]);
    assert.equal((await f.product(30)).claimsUsed, 0);
    await f.send(w[3], r, "submitClaim", [
      id(35),
      id(30),
      a[5],
      commitment("another problem"),
    ]);
    await f.connection.provider.request({
      method: "evm_increaseTime",
      params: [86401],
    });
    await f.connection.provider.request({ method: "evm_mine" });
    await f.send(w[5], r, "approveClaim", [id(35)]);
    assert.equal((await f.product(30)).claimsUsed, 0);
    await f.send(w[5], r, "completeClaim", [
      id(35),
      commitment("repair after expiry"),
    ]);
    assert.equal((await f.product(30)).claimsUsed, 1);
    await assert.rejects(
      f.send(w[3], r, "submitClaim", [
        id(36),
        id(30),
        a[5],
        commitment("too late"),
      ]),
    );
  } finally {
    await f.connection.close();
  }
});
