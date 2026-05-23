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

**Key imports**:
```ts
import { db } from '@/lib/supabase'          // Supabase client
import { currentUser, auth } from '@clerk/nextjs/server'
import { stripe, getShopStripe } from '@/lib/stripe'
import { tg } from '@/lib/telegram'           // admin notifications
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { uploadToR2, isR2Configured } from '@/lib/r2'
```
