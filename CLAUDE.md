# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build + type check
npm run typecheck    # tsc --noEmit (no build artifacts)
npm run lint         # ESLint
npm run format       # Prettier write
npm run test         # Vitest run (all tests, once)
npm run test:watch   # Vitest interactive watch
```

Run a single test file: `npx vitest run src/lib/whatsapp/encryption.test.ts`

## Architecture Overview

**Stack**: Next.js 16 App Router · React 19 · TypeScript · Tailwind v4 · Supabase (Postgres + Auth + Realtime + RLS)

### Route groups

| Group | Path | Purpose |
|---|---|---|
| `(auth)` | `/login`, `/signup`, `/forgot-password` | Unauthenticated pages |
| `(dashboard)` | `/dashboard`, `/inbox`, `/contacts`, `/pipelines`, `/broadcasts`, `/automations`, `/settings` | Protected app (redirects to `/login` via middleware) |
| `api/whatsapp/` | webhook, send, broadcast, react, media, config, templates | Meta Cloud API integration |
| `api/automations/` | CRUD, engine, cron | Automation management + execution |

Proxy at [src/proxy.ts](src/proxy.ts) enforces auth via Supabase SSR cookies. API routes under `/api/whatsapp/*` (except `/webhook`) also require auth.

### Core library modules

- **[src/lib/whatsapp/meta-api.ts](src/lib/whatsapp/meta-api.ts)** — all Meta Graph API calls (send text/template/reaction, media proxy). All functions take a single named-params object — never positional args (prevents arg-swap bugs that caused silent failures).
- **[src/lib/whatsapp/encryption.ts](src/lib/whatsapp/encryption.ts)** — AES-256-GCM encrypt/decrypt for WhatsApp tokens stored in Supabase. Legacy CBC rows are auto-upgraded lazily on read. The `ENCRYPTION_KEY` env var is a 64-char hex string (32 bytes).
- **[src/lib/whatsapp/webhook-signature.ts](src/lib/whatsapp/webhook-signature.ts)** — HMAC-SHA256 verification of inbound webhook POSTs using `META_APP_SECRET`.
- **[src/lib/whatsapp/phone-utils.ts](src/lib/whatsapp/phone-utils.ts)** — phone normalization and flexible matching for E.164 variants.
- **[src/lib/automations/engine.ts](src/lib/automations/engine.ts)** — fires active automations for a given trigger. Never throws (fire-and-forget from webhook). `wait` steps insert into `automation_pending_executions`; the cron endpoint resumes them.
- **[src/lib/automations/validate.ts](src/lib/automations/validate.ts)** — step/trigger config validation.
- **[src/lib/rate-limit.ts](src/lib/rate-limit.ts)** — in-memory fixed-window rate limiter. Works for single-instance VPS deploys; must be replaced (Redis/Upstash) for multi-instance horizontal scale.
- **[src/lib/supabase/server.ts](src/lib/supabase/server.ts)** — cookie-based Supabase client for Server Components and Route Handlers.
- **[src/lib/supabase/client.ts](src/lib/supabase/client.ts)** — browser Supabase client for Client Components.

### Supabase access pattern

- **`createClient()`** from `@/lib/supabase/server` — uses anon key + RLS. For Server Components and most API routes.
- **`supabaseAdmin()`** — uses `SUPABASE_SERVICE_ROLE_KEY`, bypasses RLS. Used only in the webhook route and automation engine (server-only code that needs cross-user data access). Never use in client-facing code.

### Real-time

[src/hooks/use-realtime.ts](src/hooks/use-realtime.ts) subscribes to Postgres changes on `messages` and `conversations` tables. Callbacks are kept in refs to avoid re-subscriptions on parent re-renders.

### Automations

Trigger types: `new_message_received`, `first_inbound_message`, `keyword_match`, `new_contact_created`, `conversation_assigned`, `tag_added`, `time_based`.

Step execution in [engine.ts](src/lib/automations/engine.ts) walks `automation_steps` ordered by `position`. `condition` steps recurse into child branches (`parent_step_id` + `branch = 'yes'|'no'`). `wait` steps suspend execution — the cron endpoint at `GET /api/automations/cron` resumes `automation_pending_executions` rows whose `run_at` has passed. Template variable params are sorted numerically to preserve `{{1}}, {{2}}, …` order.

### Broadcast status

`broadcast_recipients.status` uses a forward-only ladder: `pending → sent → delivered → read → replied`. `failed` is only accepted from `pending` or `sent`. The webhook rejects backward transitions to prevent replay attacks from scrambling aggregate counts. Aggregate counts on `broadcasts` are maintained by a Postgres trigger (migration 005).

### Database

Migrations in [supabase/migrations/](supabase/migrations/) — run them in order against your Supabase project. Every table has RLS enabled. `user_id` is the tenant key on every user-owned table.

Key non-obvious decisions in migrations:
- Migration 004: `deals.contact_id` and `broadcast_recipients.contact_id` are `ON DELETE SET NULL` (preserve history when contacts are deleted).
- Migration 007: `increment_automation_execution_count` is an RPC function to atomically increment without read-modify-write races.

### All TypeScript types

All shared types are in [src/types/index.ts](src/types/index.ts). Do not create local type files for domain entities — extend this file instead.

## Required environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — server-only, bypasses RLS |
| `ENCRYPTION_KEY` | 64 hex chars (32 bytes) for AES-256-GCM token encryption |
| `META_APP_SECRET` | Meta app secret for webhook HMAC verification |
| `AUTOMATION_CRON_SECRET` | Optional — required only if using Wait steps in automations |

Generate `ENCRYPTION_KEY`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Rotating `ENCRYPTION_KEY` orphans all existing encrypted tokens — users must re-save WhatsApp settings.
