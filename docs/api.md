# Local API and business rules

## Ethereum mode (`CHAIN_ENABLED=1`)

The business mutation endpoints listed below are the legacy SQLite-only interface and return `409 WALLET_TRANSACTION_REQUIRED` in Ethereum mode. Reads, profile editing and image uploads remain HTTP operations. Onboarding grants the chosen role. Authenticated PATCH /api/me accepts a role change for the current wallet and synchronizes it with the contract. See [the Chinese chain guide](blockchain.md).

| Endpoint | Purpose |
| --- | --- |
| `GET /api/chain/status` | Mode, deployment identity, readiness, block progress and current wallet's chain role |
| `POST /api/chain/prepare` | Authenticated strict command; simulates contract call and durably saves private text before returning unsigned transaction data |
| `POST /api/chain/confirm` | Authenticated operation ID and optional transaction hash; verifies receipt and returns synchronized entity |
| `GET /api/chain/transaction?hash=...` | Public receipt from the configured contract; full on-chain sender address is public |

Prepare command kinds are `register`, `transfer`, `transferAction`, `claim`, `claimAction`, matching the field names in `src/lib/chain-server.ts`. The signed-in wallet must send the returned `to` and `data` with zero value on chain 31337. No server endpoint signs a business transaction. Product detail and public verification add a `chain` object containing contract address and transaction evidence. Private repair text is excluded from public responses.

The remaining sections describe shared rules and the optional database-only mode (`CHAIN_ENABLED=0`).

All business APIs use the same Next.js origin. Success responses are `{ data: ... }`; errors are `{ error: { code, message } }`. Private and authentication responses disable caching. State-changing requests require an `Origin` matching the application's browser-facing host and reject `Sec-Fetch-Site: cross-site`.

## Wallet authentication

| Endpoint                   | Input                                         | Result                                                                |
| -------------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| `POST /api/auth/challenge` | `wallet_address`, positive integer `chain_id` | `{ id, message }`, plus a five-minute HttpOnly challenge cookie       |
| `POST /api/auth/verify`    | `id`, Ethereum `personal_sign` signature      | `{ profile, wallet_address }`, plus a 24-hour HttpOnly session cookie |
| `POST /api/auth/logout`    | No body needed                                | Revokes the session and clears both cookies                           |
| `GET /api/me`              | Session cookie                                | `{ profile, wallet_address }`; profile is null until onboarding       |

The server constructs the login message, including origin, address, chain ID, random nonce, issue time and expiry. Verification checks the stored message, browser-cookie hash, origin, expiry and recovered signer, then consumes the challenge in one SQLite transaction. It stores only hashes of random session tokens. A signed message cannot be replayed, and a client cannot choose a different acting user ID. The chain ID identifies the wallet's selected network; no network RPC or blockchain transaction is sent.

## Business endpoints

JSON mutations use strict schemas, reject extra fields and limit request bodies to 64 KiB. The image endpoint instead bounds multipart data. Wallet identity always comes from the verified session.

| Endpoint                               | Input                                                               | Permission / result                                                  |
| -------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `POST /api/onboarding`                 | `display_name`, `role`, `organization_name?`                        | Verified wallet; one-time role selection; `Profile`                  |
| `PATCH /api/me`                        | `display_name`, `organization_name`                                 | Onboarded user; names only                                           |
| `GET /api/dashboard`                   | —                                                                   | Own products and participating transfers/claims                      |
| `GET /api/products`                    | —                                                                   | Own `Product[]`                                                      |
| `POST /api/products`                   | `serial_number`, `model`, `warranty_duration_days`, `max_claims`    | Manufacturer; initial owner is the manufacturer                      |
| `GET /api/products/:id`                | Product UUID                                                        | Current owner, manufacturer or historical transfer/claim participant |
| `POST /api/products/:id/image`         | Multipart field `file`                                              | Registering manufacturer; `{ image_path }`                           |
| `GET /api/images/:productId/:filename` | Validated UUID path ending in `.webp`                               | Public image bytes; missing file is 404                              |
| `POST /api/products/:id/transfers`     | `to_wallet`                                                         | Current owner; registered recipient required                         |
| `GET /api/transfers`                   | —                                                                   | Sender/recipient's transfers                                         |
| `POST /api/transfers/:id/action`       | `action`: `accept`, `reject`, `cancel`                              | Recipient accepts/rejects; sender cancels                            |
| `GET /api/claims`                      | —                                                                   | Claimant/assigned center's claims                                    |
| `POST /api/claims`                     | `product_id`, `service_center_id`, `description`                    | Current customer owner                                               |
| `POST /api/claims/:id/action`          | `action`: `approve`, `reject`, `complete`; `reason?`, `resolution?` | Assigned center; rejection/completion require explanatory text       |
| `GET /api/service-centers`             | —                                                                   | Onboarded session; center IDs, organization names, wallet addresses  |
| `GET /api/verify?query=...`            | Exact product UUID or serial                                        | Public allowlisted product fields and masked history                 |

Response types are in `src/lib/types.ts`; the browser gateway is `src/lib/api-client.ts`. Models and serials allow 1–120 characters; serials are trimmed and unique using JavaScript lowercase normalization. Warranty duration is 1–36,500 days, allowance 1–1,000, and private claim/repair text 1–2,000 characters. Public verification is an exact lookup, including literal punctuation; it is not wildcard search.

## SQLite lifecycle rules

`src/lib/database.ts` initializes schema version 1 automatically. Unknown newer schema versions are rejected. Connections enable foreign keys, WAL mode and a five-second busy timeout. Mutations use `BEGIN IMMEDIATE` to serialize writers; unique partial indexes also enforce one pending transfer and one open claim per product. This is SQLite database-level write serialization, not PostgreSQL row locks.

- Transfers follow manufacturer → retailer → customer → customer. Pending offers preserve ownership; repeating the same offer returns its pending record. Accept, reject and cancel results are immutable and idempotent.
- Pending transfers and submitted/approved claims exclude each other. Authorization, entitlement checks, state updates and history insertion occur in the same transaction.
- The first accepted retailer → customer transfer starts warranty. Resale preserves start, expiry and used allowance.
- Claims transition submitted → approved → completed, or submitted → rejected. Only completion creates a service record and increments usage, exactly once. Rejected claims consume nothing.
- New submissions require `now < expiry` and remaining allowance. A previously admitted claim can finish after expiry. No background expiry job is necessary.
- Roles are selected once. Later profile changes cannot rebind wallets or elevate roles. Organization self-registration remains a prototype limitation.

Private details query ownership and record visibility in one database transaction. Current owners can read recorded repairs; previous owners and assigned centers retain only repairs associated with their claims. Claim descriptions, decisions and resolutions are limited to the original claimant and assigned center. Manufacturers and transfer participants can view provenance but not unrelated private repairs.

The public verifier explicitly excludes user UUIDs, full wallet addresses, customer names, all claims and repair descriptions. Product/history IDs and manufacturer organization names are public. Images are intentionally public and are served from validated local paths, never arbitrary filesystem paths.

Image writes occur outside the SQLite transaction while Sharp/filesystem work runs. A conditional database update compares the original image path, and a losing request removes its new file. Successful replacement attempts to remove the old image. An abrupt process crash between filesystem and database operations may leave an unreferenced file; images and database require coordinated backup.

## Tests and future blockchain boundary

`tests/database.test.ts` exercises the actual SQLite implementation, including persistence after closing/reopening, role/ownership checks, workflow conflicts, warranty boundaries, private visibility and transaction rollback. `tests/auth.test.ts` and `tests/auth-route.test.ts` exercise real signatures, hashed sessions, route schemas, logout and local image files. Tests never require a cloud service.

The browser lifecycle uses five independently signed wallets against actual APIs and a dedicated SQLite file. Other UI fixture tests remain explicitly scoped to presentation behavior.

No blockchain state, transaction hashes or smart contracts are produced. To satisfy the course's decentralized implementation requirement, move authoritative ownership, warranty entitlement and claim decisions to the chosen contract platform, add deployment and contract tests, and reconcile events into this local database. Keep personal profiles and private repair text off-chain and define the intended disclosure of public wallet histories.
