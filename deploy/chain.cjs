const { readFileSync } = require("node:fs");
const ganache = require("ganache");
const server = ganache.server({
  chain: { chainId: 31338, networkId: 31338, hardfork: "shanghai" },
  database: { dbPath: "/srv/dapp/ledger/db" },
  wallet: { mnemonic: readFileSync("/etc/dapp-chain-seed", "utf8").trim(), totalAccounts: 6 },
  logging: { quiet: true }
});
server.listen(18546, "127.0.0.1").catch(() => process.exit(1));
process.on("SIGTERM", async () => { await server.close(); process.exit(0); });
