# Agent index — miyagisanchez.com

## What is this?

**miyagisanchez.com** — a multi-seller marketplace for Mexico. Sellers create shops, list products (physical, digital, subscription, service, rental), and get paid via Stripe Connect, MercadoPago, or SPEI bank transfer. All UI is bilingual ES/EN. Stack: Next.js 16 App Router · React 19 · Supabase · Clerk · Tailwind CSS v4.

**Workflow**: Daniel commits directly to `main` → auto-deploys to Vercel. No PR process. Revert with `git revert HEAD` if something breaks.

---

## ⚠️ Three critical rules

**1. Bilingual — mandatory.** Every user-visible string needs a key in BOTH `locales/en.json` AND `locales/es.json`. Never hardcode English text in `.tsx`. See [conventions.md](.claude/context/conventions.md#bilingual).

**2. This Next.js has breaking changes.** Version 16 / React 19. `params` and `searchParams` are Promises — always `await` them. `cookies()` and `headers()` are async. Read `node_modules/next/dist/docs/` before writing unfamiliar code.

**3. Subscriptions require login; one-time purchases don't.** Auth heuristic: guests can buy normal products (Stripe Checkout collects email). Subscriptions must check `currentUser()` and return 401 if null — buyer identity is needed for lifecycle management.

---

## Context routing — read only what you need

| I'm working on… | Read these docs |
|---|---|
| New payment flow (checkout, webhook, refund) | [payments.md](.claude/context/payments.md) |
| Subscription feature (tiers, content, buyer portal) | [payments.md](.claude/context/payments.md#subscriptions) |
| Seller portal (`/sell`, `/shop/manage/*`) | [seller.md](.claude/context/seller.md) |
| New DB table or query | [database.md](.claude/context/database.md) |
| API route, auth, error handling, rate limiting | [conventions.md](.claude/context/conventions.md) |
| UI component, i18n, Tailwind patterns | [conventions.md](.claude/context/conventions.md) |
| File upload (images, digital goods) | [conventions.md](.claude/context/conventions.md#storage) |
| New page / routing / layout | [architecture.md](.claude/context/architecture.md) |
| Admin features, scrapers, supply import | [architecture.md](.claude/context/architecture.md#admin) |
| UCP / AI agent commerce APIs | [architecture.md](.claude/context/architecture.md#ucp) |

---

## Quick-reference

```bash
# Dev (port 3001, Turbopack)
npm run dev

# Type-check
npx tsc --noEmit

# Build
npm run build

# Seed DB
npm run seed
```

**Key env vars** (check `.env.local`):
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — always use service role for server-side
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY`
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`
- `MP_ACCESS_TOKEN` — MercadoPago
- `R2_*` — Cloudflare R2 (images bucket); `R2_DIGITAL_*` (private digital files bucket)
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` — admin notifications (Daniel only)
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — rate limiting
- `VERCEL_API_TOKEN` + `VERCEL_PROJECT_ID` — custom domain provisioning (own channel feature)

**Key imports**:
```ts
import { db } from '@/lib/supabase'          // Supabase client
import { currentUser, auth } from '@clerk/nextjs/server'
import { stripe, getShopStripe } from '@/lib/stripe'
import { tg } from '@/lib/telegram'           // admin notifications
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { uploadToR2, isR2Configured } from '@/lib/r2'
import { detectChannel } from '@/lib/channel'  // federated commerce channel tagging
```

---

## Federated Commerce — Channels

Miyagi Sánchez uses a **channels model**: each seller's products live in one place and are surfaced through multiple independent storefronts.

| Channel | URL pattern | Purpose |
|---|---|---|
| Marketplace | `miyagisanchez.com/s/[slug]` | Discovery, cross-seller traffic, SEO |
| Own domain | `theirshop.mx` (any domain) | Brand identity, direct traffic, white-label |
| Embed widget | `<script>` tag on any site | Existing audiences on other platforms |
| API / UCP | `/api/ucp/*` | Headless, programmatic, AI agents |

### How custom domain routing works

1. Seller enters their domain in `/shop/manage/settings` → "Canal Propio" section
2. API route `POST /api/sell/shop/domain` saves to `marketplace_shops.custom_domain` and calls Vercel Domains API to provision SSL
3. Seller adds `CNAME theirshop.mx → cname.vercel-dns.com` (or uses Cloudflare one-click flow)
4. **Middleware** (`middleware.ts`) detects non-platform hostnames, looks up shop by `custom_domain`, and rewrites to `/s/[slug]` with header `x-miyagi-channel: custom`
5. `/s/[slug]/page.tsx` reads the header → renders `<ChannelLayout>` (no platform chrome) instead of the standard root layout

### New files

```
lib/vercel-domains.ts          — addDomainToProject / getDomainStatus / removeDomainFromProject
lib/channel.ts                 — detectChannel(req) → 'marketplace' | 'custom_domain' | 'embed' | 'api'
app/s/[slug]/ChannelLayout.tsx — white-label shell (branded nav + footer, no miyagisanchez chrome)
app/api/sell/shop/domain/      — POST/GET/DELETE domain API route
app/api/sell/shop/domain/cloudflare/ — Cloudflare DNS one-click automation
supabase/migrations/20260524000000_custom_domain.sql
```

### DB columns added to marketplace_shops

| Column | Type | Purpose |
|---|---|---|
| `custom_domain` | `VARCHAR(255) UNIQUE` | Tenant's custom domain (e.g. `myshop.mx`) |
| `custom_domain_verified` | `BOOLEAN` | Vercel has verified DNS + SSL |
| `custom_domain_vercel_ok` | `BOOLEAN` | Domain registered on Vercel project |

### Channel tagging on sales

All checkout routes (`/api/stripe/checkout`, `/api/stripe/subscription-checkout`, `/api/mp/checkout`) call `detectChannel(req)` and include a `channel` field in Stripe metadata / MP `external_reference`. This enables per-channel revenue analytics in future dashboard work.
