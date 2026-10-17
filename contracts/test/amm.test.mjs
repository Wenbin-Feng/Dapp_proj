import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEther, zeroAddress } from "viem";
import { artifact, fixture } from "./helpers.mjs";
import {
  factoryBuild,
  pairBuild,
  routerBuild,
  wethBuild,
  expectedPair,
} from "../../scripts/uniswap.mjs";

test("official V2 pair: fee, bidirectional swaps, slippage/deadline and LP lifecycle", async () => {
  const f = await fixture();
  try {
    const build = await artifact("DemoToken");
    const a = await f.deploy(build, ["PDC", "PDC", f.accounts[0]]);
    const b = await f.deploy(build, ["PDQ", "PDQ", f.accounts[0]]);
    const factory = await f.deploy(factoryBuild, [f.accounts[0]]);
    const weth = await f.deploy(wethBuild);
    const router = await f.deploy(routerBuild, [factory.address, weth.address]);
    await f.send(f.wallets[0], factory, "createPair", [a.address, b.address]);
    const pair = {
      address: await f.read(factory, "getPair", [a.address, b.address]),
      abi: pairBuild.abi,
    };
    assert.equal(
      pair.address.toLowerCase(),
      expectedPair(factory.address, a.address, b.address).toLowerCase(),
    );
    assert.equal(await f.read(factory, "feeTo"), zeroAddress);
    const deadline = () =>
      f.client.getBlock().then((block) => block.timestamp + 600n);
    const seed = parseEther("100000");
    for (const token of [a, b])
      await f.send(f.wallets[0], token, "approve", [router.address, seed]);
    await f.send(f.wallets[0], router, "addLiquidity", [
      a.address,
      b.address,
      seed,
      seed,
      seed,
      seed,
      f.accounts[0],
      await deadline(),
    ]);
    assert.equal(await f.read(pair, "totalSupply"), seed);
    assert.equal(await f.read(pair, "balanceOf", [zeroAddress]), 1000n);
    assert.equal(
      await f.read(pair, "balanceOf", [f.accounts[0]]),
      seed - 1000n,
    );
    for (const token of [a, b]) {
      await f.send(f.wallets[0], token, "transfer", [
        f.accounts[1],
        parseEther("5000"),
      ]);
      await f.send(f.wallets[1], token, "approve", [
        router.address,
        parseEther("1000"),
      ]);
    }
    await f.send(f.wallets[1], router, "addLiquidity", [
      a.address,
      b.address,
      parseEther("1000"),
      parseEther("1000"),
      parseEther("990"),
      parseEther("990"),
      f.accounts[1],
      await deadline(),
    ]);
    assert.equal(
      await f.read(pair, "balanceOf", [f.accounts[1]]),
      parseEther("1000"),
    );
    for (const [input, output] of [
      [a, b],
      [b, a],
    ]) {
      const amount = parseEther("1000");
      const reserveIn = await f.read(input, "balanceOf", [pair.address]);
      const reserveOut = await f.read(output, "balanceOf", [pair.address]);
      const expected =
        (amount * 997n * reserveOut) / (reserveIn * 1000n + amount * 997n);
      const quote = await f.read(router, "getAmountsOut", [
        amount,
        [input.address, output.address],
      ]);
      assert.equal(quote[1], expected);
      await assert.rejects(
        f.send(f.wallets[1], router, "swapExactTokensForTokens", [
          amount,
          expected,
          [input.address, output.address],
          f.accounts[1],
          await deadline(),
        ]),
      );
      await f.send(f.wallets[1], input, "approve", [router.address, amount]);
      await assert.rejects(
        f.send(f.wallets[1], router, "swapExactTokensForTokens", [
          amount,
          expected + 1n,
          [input.address, output.address],
          f.accounts[1],
          await deadline(),
        ]),
      );
      await assert.rejects(
        f.send(f.wallets[1], router, "swapExactTokensForTokens", [
          amount,
          expected,
          [input.address, output.address],
          f.accounts[1],
          1n,
        ]),
      );
      const before = await f.read(output, "balanceOf", [f.accounts[1]]);
      await f.send(f.wallets[1], router, "swapExactTokensForTokens", [
        amount,
        expected,
        [input.address, output.address],
        f.accounts[1],
        await deadline(),
      ]);
      assert.equal(
        await f.read(output, "balanceOf", [f.accounts[1]]),
        before + expected,
      );
      assert.equal(
        await f.read(input, "allowance", [f.accounts[1], router.address]),
        0n,
      );
      const [r0, r1] = await f.read(pair, "getReserves");
      assert.ok(r0 * r1 >= reserveIn * reserveOut);
    }
    for (const [owner, fraction] of [
      [1, 2n],
      [1, 1n],
      [0, 1n],
    ]) {
      const liquidity =
        (await f.read(pair, "balanceOf", [f.accounts[owner]])) / fraction;
      const supply = await f.read(pair, "totalSupply");
      const expectedA =
        (liquidity * (await f.read(a, "balanceOf", [pair.address]))) / supply;
      const expectedB =
        (liquidity * (await f.read(b, "balanceOf", [pair.address]))) / supply;
      await f.send(f.wallets[owner], pair, "approve", [
        router.address,
        liquidity,
      ]);
      const beforeA = await f.read(a, "balanceOf", [f.accounts[owner]]);
      await f.send(f.wallets[owner], router, "removeLiquidity", [
        a.address,
        b.address,
        liquidity,
        expectedA,
        expectedB,
        f.accounts[owner],
        await deadline(),
      ]);
      assert.equal(
        await f.read(a, "balanceOf", [f.accounts[owner]]),
        beforeA + expectedA,
      );
    }
    assert.equal(await f.read(pair, "totalSupply"), 1000n);
    const [r0, r1] = await f.read(pair, "getReserves");
    assert.ok(r0 > 0n && r1 > 0n);
    await assert.rejects(
      f.read(router, "getAmountsOut", [0n, [a.address, b.address]]),
    );
  } finally {
    await f.connection.close();
  }
});
