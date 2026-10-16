# Test-network currencies

PDC and PDQ are demonstration assets with no redemption or monetary-value promise.
Both use OpenZeppelin ERC20 5.6.1, fixed at 1,000,000 tokens with 18 decimals.
There is no externally callable mint function. All money values use integer base units.

## Local setup

1. `npm ci`, then `npm run contracts:test` (the pinned npm solc compiler is used offline).
2. In one terminal, `npm run chain:node`. Only bind the unlocked Hardhat node to localhost.
3. In another, `npm run chain:deploy-tokens`. The first local account is the treasury;
   five other local accounts receive 10,000 of each token. Local accounts already have test ETH.
4. Put `DEMO_DEPLOYMENT_FILE=deployments/31337.json` and
   `DEMO_PUBLIC_RPC_URL=http://127.0.0.1:8545` in `.env.local`, alongside the existing Supabase settings.
   Keep `PRODUCT_BACKEND=database` until the product contract and SQL are ready.
5. `npm run dev`. Add chain ID 31337 and that localhost RPC to MetaMask, and import
   **only a disposable local Hardhat test account**. Sign into the existing application.
6. Open **Demo wallet**. Transfer between two test wallets, then verify balances and the receipt.

`deployments/<chainId>.json` is an ignored, public-address deployment journal. Each
transaction hash is saved before waiting for its receipt. A retry resumes the journal;
it does not automatically issue new tokens or repeat distributions. Never remove a
Sepolia journal to “retry”. If a local node is reset, archive its journal explicitly
before creating a new local deployment. Do not use Hardhat keys outside a local node.

## AMM and LP setup

After deploying tokens, run `npm run chain:deploy-amm`. This deploys the pinned
official Factory, WETH9 and Router02, creates PDC/PDQ, and seeds 100,000 of each
from the treasury. The script journals and resumes this step without a second
deposit. It refuses to seed an unexpectedly funded pool. Keep protocol fees off.
Restart Next.js if deployment configuration changed, then open **Exchange** or
**Liquidity**. The same manifest contains all addresses and the starting block.

Exchange and liquidity approvals use exact amounts. After each approval the
page requotes; the user separately confirms the operation. Quotes use one block
snapshot, integer amounts, 1% minimum-amount protection and a 10-minute chain
timestamp deadline. A large price impact is separate from slippage tolerance.
LP estimates account for both token ratios and floor rounding. A dust-sized
operation that cannot have nonzero protected minima is rejected.

Other LPs can withdraw; fees stay in reserves. Withdrawals return the current
asset mixture, with possible impermanent loss. The pool's instant price is never
used to value products. See [protocol provenance](uniswap-attribution.md).

## Sepolia handoff (separate from website CI)

Set `DEMO_CHAIN_ID=11155111`, a Sepolia `DEMO_RPC_URL`, a funded test treasury's
`DEMO_DEPLOYER_PRIVATE_KEY`, matching `DEMO_TREASURY`, and five comma-separated
`DEMO_WALLETS` as local shell variables. Do not commit or paste the key in issues.
Fund the five wallets with test ETH separately. Run the same deployment command once.
Review the journal's network, addresses, version, starting block and ABI/compiler versions.
Configure `DEMO_DEPLOYMENT` with that manifest JSON and `DEMO_PUBLIC_RPC_URL` with
a public HTTPS test RPC. The public RPC is intentionally sent to the browser; do not
put a private RPC credential there. `DEMO_RPC_URL` remains server-only.

Website CI runs contract tests but **never deploys contracts**. Website releases reuse
the configured deployment; they must not remint the currencies. With no manifest,
the new pages explain that the demo network has not been configured.

MetaMask login only proves identity; each operation separately requires wallet
confirmation and test ETH. Cancellation, reverted receipts and pending/time-out
receipts are shown separately. A hash alone is never treated as success. Browser
history is local; the token log view can read earlier blocks directly from the chain.
Exact allowances are preferred; revocation is a separate on-chain operation.

Sources: [OpenZeppelin ERC20](https://docs.openzeppelin.com/contracts/5.x/erc20),
[Hardhat](https://hardhat.org/docs/getting-started),
[viem wallet clients](https://viem.sh/docs/clients/wallet).
