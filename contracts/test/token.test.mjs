import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEther, zeroAddress } from "viem";
import { artifact, fixture } from "./helpers.mjs";

test("fixed supply, decimals, transfers and exact allowances", async () => {
  const f = await fixture();
  try {
    const build = await artifact("DemoToken");
    const pdc = await f.deploy(build, [
      "Passport Demo Coin",
      "PDC",
      f.accounts[0],
    ]);
    const pdq = await f.deploy(build, [
      "Passport Demo Quote",
      "PDQ",
      f.accounts[0],
    ]);
    for (const token of [pdc, pdq]) {
      assert.equal(await f.read(token, "totalSupply"), parseEther("1000000"));
      assert.equal(await f.read(token, "decimals"), 18);
      assert.equal(
        await f.read(token, "balanceOf", [f.accounts[0]]),
        parseEther("1000000"),
      );
      assert.equal(
        token.abi.some(
          (entry) => entry.type === "function" && /mint/i.test(entry.name),
        ),
        false,
      );
    }
    await assert.rejects(f.deploy(build, ["Bad", "BAD", zeroAddress]));
    await f.send(f.wallets[0], pdc, "transfer", [
      f.accounts[1],
      parseEther("2.5"),
    ]);
    assert.equal(
      await f.read(pdc, "balanceOf", [f.accounts[1]]),
      parseEther("2.5"),
    );
    await assert.rejects(
      f.send(f.wallets[1], pdc, "transfer", [f.accounts[0], parseEther("3")]),
    );
    await assert.rejects(
      f.send(f.wallets[2], pdc, "transferFrom", [
        f.accounts[1],
        f.accounts[2],
        1n,
      ]),
    );
    await f.send(f.wallets[1], pdc, "approve", [
      f.accounts[2],
      parseEther("1"),
    ]);
    await f.send(f.wallets[2], pdc, "transferFrom", [
      f.accounts[1],
      f.accounts[2],
      parseEther("1"),
    ]);
    assert.equal(
      await f.read(pdc, "allowance", [f.accounts[1], f.accounts[2]]),
      0n,
    );
    await assert.rejects(
      f.send(f.wallets[2], pdc, "transferFrom", [
        f.accounts[1],
        f.accounts[2],
        1n,
      ]),
    );
  } finally {
    await f.connection.close();
  }
});
