# group project business API

The HTTP write interfaces below describe the default database backend. With
`PRODUCT_BACKEND=chain`, reads use the independent confirmed event model and
legacy business writes return `409 WALLET_TRANSACTION_REQUIRED`; the existing UI
uses the wallet adapter instead. Images remain authenticated off-chain uploads.
See [product settlement](product-settlement.md) for chain operations and recovery.

All responses use `{ "data": value }`. Errors use `{ "error": { "code": "...", "message": "..." } }` with the corresponding HTTP status. Responses are never cached. JSON write requests require a same-origin `Origin` header and `Content-Type: application/json`.

Except for `/api/verify`, business endpoints require a server-verified Supabase Ethereum Web3 session and a completed profile. Actor IDs and roles come from the verified session; clients cannot submit them. The service-role client stays in server-only modules. All six `dapp_*` business tables have RLS enabled and no direct permissions for anonymous/authenticated clients. All eight business RPCs, including the authorized repair-record query, are executable only by the backend service role.

## Interfaces

| Method and path                    | Input                                                               | Result and authorization                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /api/dashboard`               | —                                                                   | `DashboardData`: currently owned products and transfers/claims involving the viewer                      |
| `GET /api/products`                | —                                                                   | `Product[]` currently owned by the viewer                                                                |
| `POST /api/products`               | `serial_number`, `model`, `warranty_duration_days`, `max_claims`    | `Product`; manufacturers only; initial owner is the manufacturer                                         |
| `GET /api/products/:id`            | Product UUID                                                        | `ProductDetail`; current owner, manufacturer, transfer participant or assigned claim participant         |
| `POST /api/products/:id/transfers` | `to_wallet`                                                         | `Transfer`; current owner only; recipient must have completed onboarding                                 |
| `GET /api/transfers`               | —                                                                   | `Transfer[]` where viewer is sender or recipient                                                         |
| `POST /api/transfers/:id/action`   | `action`: `accept`, `reject`, `cancel`                              | `Transfer`; recipient accepts/rejects, sender cancels                                                    |
| `GET /api/claims`                  | —                                                                   | `Claim[]` submitted by viewer or assigned to their service center                                        |
| `POST /api/claims`                 | `product_id`, `service_center_id`, `description`                    | `Claim`; current customer owner only                                                                     |
| `POST /api/claims/:id/action`      | `action`: `approve`, `reject`, `complete`; `reason?`, `resolution?` | `Claim`; assigned service center only; rejection needs a reason and completion needs a repair resolution |
| `GET /api/service-centers`         | —                                                                   | `{ id, organization_name, wallet_address }[]`; onboarded session required                                |
| `GET /api/verify?query=...`        | Exact product UUID or serial number                                 | `PublicProductDetail`; public, case-insensitive serial lookup, no wildcard search                        |

Contracts are declared in `src/lib/types.ts` and consumed through the `productGateway` in `src/lib/api-client.ts`. UUIDs identify products, claims and transfers. Serial numbers are trimmed and unique ignoring case. Models/serials allow 1–120 characters, warranty duration 1–36,500 days, maximum claims 1–1,000, and private claim/repair text 1–2,000 characters.

## Lifecycle rules

- Transfers follow manufacturer → retailer → customer → another customer. A pending transfer does not change ownership. Repeating the same pending offer returns its existing record. The sender can cancel and the recipient can reject; terminal results remain immutable.
- Product rows are locked for every transfer/claim mutation. At most one pending transfer or one submitted/approved claim may exist, and these two workflows exclude each other. Product locks and partial unique indexes prevent two concurrent workflows from being admitted.
- Warranty starts when the first retailer → customer transfer is accepted. Later transfers keep the original start, expiration and used count. Registration, retailer acquisition and rejected offers do not start warranty.
- Claims transition submitted → approved → completed, or submitted → rejected. Rejected claims consume no entitlement. Only completion increments the used count and creates a repair record, once. Duplicate terminal actions return the existing result without overwriting text or adding history.
- New claims require `now < warranty_expires_at` and `claims_used < max_claims`. Eligibility is checked at submission. A valid admitted claim may be approved and completed after expiration. Expiration is evaluated at request time; no background job is needed.
- The four roles are freely chosen once at onboarding for the classroom prototype. Repeated onboarding never changes the role or wallet. Later profile edits change only display/organization names.

## Privacy and replacement boundary

The public verifier returns product identity, public manufacturer name, warranty facts and masked ownership history. It excludes full wallet addresses, profile IDs, names of customers, private claim descriptions/reasons/resolutions, and all service records. Product and history UUIDs are public identifiers, not user UUIDs.

Private product details include claims only when the viewer submitted them or is the assigned service center. Repair records are visible to the current owner; original claimants and their assigned centers retain access to their own repairs. The `dapp_visible_service_records` RPC joins the current product owner and claim participants in the same statement as the private-record query, preventing an earlier ownership snapshot from authorizing records created after a concurrent transfer. A previous owner cannot read another owner's private claim text. Historical participants and the manufacturer can inspect provenance but receive no unrelated private claim or repair descriptions.

The current implementation records database operations, not blockchain transactions. To integrate the eventual contract, replace the gateway/backend business commands and reconcile accepted ownership/claim events with the database; keep personal profiles and private repair text off-chain. Do not fabricate transaction hashes. The API authentication and privacy checks remain necessary when replacing the mock business adapter.

## Database installation and verification

Apply `supabase/migrations/202610140001_initial.sql` using an authorized Supabase SQL session. It creates only names prefixed `dapp_`, does not drop user tables or storage buckets, and is safe to reapply. It expects Supabase's `auth.users` and standard `anon`, `authenticated`, `service_role` roles.

`tests/database.test.ts` applies the actual migration twice to an isolated PGlite PostgreSQL database and runs `tests/database-lifecycle.sql`. Scenarios cover role/owner authorization, actor-parameter RPC access restrictions, initial registration, case-insensitive serial uniqueness, transfer confirmation/rejection/cancellation, workflow exclusion, resale, entitlement expiry/exhaustion, service completion after expiry, idempotency, previous-owner denial, and private repair visibility for current/previous owners, assigned centers and nonparticipants. Test accounts exist only inside a rolled-back local transaction.
