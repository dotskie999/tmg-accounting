# TMG Accounting

TMG Accounting is a private inventory, recipe-costing, and menu-pricing application for food businesses. It uses current replacement cost rather than FIFO and recalculates dependent recipes when a purchased item changes price.

## Stack

- Next.js App Router, React, and TypeScript
- Supabase Auth
- Supabase Postgres through the Data API
- Vercel deployment

## Local setup

1. Create a Supabase project.
2. In the Supabase SQL Editor, apply these files in order:
   - `supabase/migrations/202610150002_normalized_accounting_schema.sql`
   - `supabase/migrations/202610150003_normalized_state_rpc.sql`
   - `supabase/migrations/202610150004_reset_and_remove_legacy_workspace.sql`
3. Copy `.env.example` to `.env.local` and enter the project URL, publishable key, and server-only secret key.
4. In Supabase Auth URL Configuration, set the local redirect URL to `http://localhost:3000/auth/callback`.
5. Run `npm install`, then `npm run dev`.

Migration 004 intentionally clears all accounting data and removes the old `workspaces` table. Supabase Auth users are preserved.

The secret key is used only by the server-side accounting API. Browser clients cannot write the accounting tables directly, so every mutation passes through the TMG Accounting rules and audit trail.

## Required environment variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `NEXT_PUBLIC_SITE_URL`

Legacy Supabase `anon` and `service_role` keys are accepted through `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, but the newer publishable and secret keys are preferred.

## Verification

```sh
npm test
npm run lint
npm run build
```

## Vercel deployment

1. Link or import this project in Vercel.
2. Add the four environment variables to Development, Preview, and Production as appropriate.
3. Set `NEXT_PUBLIC_SITE_URL` to the canonical deployment URL for each environment.
4. Add the production callback URL (`https://your-domain/auth/callback`) to Supabase Auth redirect URLs.
5. Deploy a preview and verify sign-in, first-workspace creation, one inventory update, and refresh persistence.
6. Promote or deploy to Production.

Environment variables are never committed; `.env*` is ignored by Git.
