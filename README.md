# Origin — Product Provenance & Warranty

An English, dark-themed product passport application for COMP5565. Four wallet roles cover product registration, retail delivery, resale, and warranty service.

The current implementation uses Next.js and Supabase to simulate the contract business logic. It does not submit blockchain transactions or claim that database records are immutable on-chain. MetaMask signatures are used for actual wallet authentication. See [the interface handoff](docs/api.md) before replacing the business gateway with smart contracts.

## Run locally

Requires Node.js 24 LTS and npm (`.nvmrc`, CI and Vercel all use Node 24). Run from this directory:

```sh
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. The local `.env.local` has been configured for the supplied project; do not commit or share that file. For another machine, fill in the URL, publishable key, and server-only secret key. Product images use the `dapp` bucket.

## Supabase setup (required before signing in)

1. Open the project's **SQL Editor**, create a query, paste the complete contents of `supabase/migrations/202610140001_initial.sql`, and run it. This creates the application's prefixed tables and transaction functions without deleting unrelated data. It can be executed again safely.
2. Under **Authentication → Sign In / Providers**, enable **Web3 / Ethereum**.
3. Under **Authentication → URL Configuration**, set the local site URL to `http://localhost:3000` and add `http://localhost:3000/**` to Redirect URLs. If using `127.0.0.1`, add that URL separately. Add the actual HTTPS domain when deploying.
4. The existing **public** Storage bucket is named `dapp`. Public retrieval is intentional for product display images. Keep anonymous writes disabled: all uploads go through authenticated Next.js endpoints, using the secret key only on the server. Suggested bucket restrictions: 1 MB; `image/webp`, `image/jpeg`, `image/png`. The upload endpoint independently enforces these restrictions.

The client publishable key cannot create database tables or enable Auth providers. The initial remote schema/provider setup therefore requires the Dashboard or a separate database-management connection; the supplied app keys alone are insufficient.

## First login and roles

Use a browser with the MetaMask extension. Connect, approve the login message signature (no payment), and fill in a display name and role. Organization roles also need an organization name. A wallet has one account; its role is fixed after registration. Role self-selection is an explicit classroom-prototype choice. A production deployment should authorize organization roles independently.

Only the display/organization names can subsequently be edited. The server derives wallet ownership from the verified Supabase Web3 identity; it never trusts a wallet address or actor ID supplied in a request. Changing the connected MetaMask account signs out the previous app session and requires a fresh wallet login.

## Demonstration sequence

Use five test wallets: Manufacturer, Retailer, Customer A, Customer B, and Service Center. Complete onboarding for each before transferring products to it.

1. Manufacturer registers an electronics product and optionally uploads its image.
2. Manufacturer requests a transfer to the retailer's wallet; retailer accepts it.
3. Retailer requests delivery to Customer A; Customer A accepts. This starts warranty coverage.
4. Customer A chooses the registered service center and submits a warranty claim.
5. The assigned service center approves and completes the repair, providing a service description. Only completion consumes a claim allowance; rejection requires a reason and consumes none.
6. Customer A transfers to Customer B, who accepts. Remaining coverage and service history are retained.
7. Visit `/verify` without signing in, using the serial number, product ID, or generated QR link. This exposes only product information and masked ownership events.

A pending transfer blocks warranty submission. A submitted/approved claim blocks ownership transfer. Submitted claims keep their entitlement if warranty expires during processing. Exact expiry or claim exhaustion prevents new submissions.

## Product images

Select a JPEG, PNG, or WebP under 10 MB and 25 megapixels. The browser corrects orientation, preserves proportions and transparency, scales the longest edge to at most 1600 pixels, and encodes WebP at initial quality 0.82. It progressively reduces quality/dimensions toward 500 KB; the hard upload limit is 1 MB. No uncompressed fallback is uploaded silently.

Next.js verifies manufacturer permissions, bounds the request, decodes the real file with Sharp, strips source metadata and re-encodes a static WebP. Stored paths are `products/<product-id>/<random-id>.webp`. Replacements receive new URLs to avoid stale CDN content; a failed update retains the prior image. Database rows store object paths rather than user-supplied URLs.

## Checks

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Tests include actual PostgreSQL migration/RPC scenarios in isolated PGlite, image normalization, warranty boundary dates, request origin checks, and verified wallet identity rules. Browser tests cover responsive layouts, the actual browser image compressor, and UI workflows against intercepted test-only API fixtures; they are not a substitute for a real signed wallet/cloud session. Tests do not modify the cloud database. The real MetaMask signature and cloud workflow need a browser wallet and the above Supabase setup.

## Deployment

The repository uses `main`/feature branches for development and `release` for production. Every push to `release` runs checks, then deploys to Vercel when its credentials are configured. Other branches run CI without production deployment. See [the deployment setup guide](docs/deployment.md) for the one-time Vercel/GitHub setup and branch commands.

Use a Node.js-capable Next.js host (including Vercel); static export cannot run the API. Configure the same environment variables and an HTTPS app URL. The secret key must never use a `NEXT_PUBLIC_` prefix. Set Auth redirect URLs for the deployed hostname. On deployment, use a newly rotated secret key instead of credentials that have been pasted into a conversation.

Private app tables have RLS enabled and deny direct anonymous/authenticated table access. Trusted server routes explicitly authorize each request; narrowly exposed public verification returns no display names, descriptions, raw wallet addresses, or user UUIDs. Business state changes use PostgreSQL row locks and transaction functions. This is a centralized prototype and requires the later contract implementation for the course's final blockchain requirement.
