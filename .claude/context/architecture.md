# Architecture

## Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 16.2.6, App Router | `params`/`searchParams` are Promises — always `await` |
| Runtime | React 19.2.4 | `use client` only where interactivity is needed |
| Styling | Tailwind CSS v4 | No config file — uses CSS variables via `--color-*` |
| Database | Supabase (Postgres) | Service role key only; no RLS on server side |
| Auth | Clerk v7 | `@clerk/nextjs` — `currentUser()` in server components/routes |
| Hosting | Vercel | Auto-deploys from `main`; `npm run dev` on port 3001 |

## File structure

```
miyagisanchez/
├── app/
│   ├── layout.tsx                    ← root layout, ClerkProvider, fonts
│   ├── page.tsx                      ← homepage
│   ├── l/                            ← listing browse (/l) + detail (/l/[id])
│   ├── s/[slug]/                     ← seller storefront + claim flow
│   ├── sell/                         ← /sell onboarding + /sell/edit/[id]
│   ├── shop/manage/                  ← seller portal (protected by middleware)
│   │   ├── page.tsx                  ← dashboard hub
│   │   ├── settings/                 ← ShopSettings panel
│   │   ├── analytics/                ← MRR/ARR charts (subscriptions)
│   │   ├── subscriptions/            ← manage subscriber list + SPEI confirm
│   │   ├── content/                  ← gated content library
│   │   └── offers/                   ← incoming offers inbox
│   ├── account/subscriptions/        ← buyer: active subscriptions + content
│   ├── payment/success/              ← post-checkout landing page
│   ├── api/
│   │   ├── sell/                     ← listing CRUD, shop PATCH, image/file upload
│   │   ├── stripe/                   ← checkout, subscription, connect, billing portal
│   │   ├── mp/                       ← MercadoPago checkout + subscription checkout
│   │   ├── subscriptions/            ← subscription list, SPEI flow, cancel
│   │   ├── offers/                   ← offer create + respond
│   │   ├── webhooks/stripe/          ← Stripe event processor
│   │   ├── webhooks/mercadopago/     ← MP notification processor
│   │   ├── ucp/                      ← AI agent commerce APIs (catalog, checkout-session, mcp)
│   │   ├── cron/                     ← listing cleanup + offer reminders
│   │   ├── supply/                   ← bulk import pipeline
│   │   └── admin/                    ← scraper admin
│   └── components/                   ← BuyButton, MercadoPagoButton, MakeOfferButton
├── lib/
│   ├── supabase.ts                   ← db client
│   ├── stripe.ts                     ← Stripe singleton, getShopStripe()
│   ├── stripe-subscriptions.ts       ← createSubscriptionCheckout(), createBillingPortalSession()
│   ├── mercadopago.ts                ← MP preapproval plan + preapproval
│   ├── r2.ts                         ← Cloudflare R2 upload/delete/presigned
│   ├── listings.ts                   ← searchListings(), getListing() with ISR caching
│   ├── types.ts                      ← Listing, Shop, SearchParams types
│   ├── telegram.ts                   ← tg.newShop(), tg.salePaid(), tg.newSubscription()…
│   ├── ratelimit.ts                  ← checkRateLimit(), getClientIp()
│   ├── email.ts                      ← Resend email sender
│   ├── offers.ts                     ← offer logic helpers
│   ├── encryption.ts                 ← AES-256-GCM for sensitive stored tokens
│   ├── calcom.ts                     ← Cal.com API integration
│   └── ucp/                          ← UCP schema, identity, webhooks
├── supabase/migrations/              ← all DB migrations (run via Supabase CLI)
├── locales/en.json + es.json         ← ALL user-visible strings
├── AGENTS.md                         ← always read first (you're in it)
└── .claude/context/                  ← specialist docs (read on demand)
```

## Routing rules (Next.js 15+)

```ts
// ❌ Wrong — params is a Promise in Next.js 15+
export default function Page({ params }: { params: { id: string } }) {
  const { id } = params // will be undefined at build time
}

// ✅ Correct
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
}

// searchParams same pattern
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams
}
```

## CSS design tokens

The app uses CSS variables, not Tailwind's default palette:

```css
var(--color-text)           /* primary text */
var(--color-muted)          /* secondary/muted text */
var(--color-accent)         /* brand green #1d6f42 */
var(--color-accent-hover)   /* darker accent */
var(--color-border)         /* borders */
var(--color-background)     /* page background */
var(--color-surface-alt)    /* card / panel background */
```

Never use `text-gray-600` etc. — always use `text-[var(--color-muted)]`.

## Protected routes

`middleware.ts` protects `/shop/manage(.*)` — Clerk redirects to `/sign-in` automatically. All other routes are public. For API routes that need auth, call `currentUser()` (returns null if not signed in) or `auth()` and handle 401 manually.

---

<a name="admin"></a>
## Admin & Scrapers

- `/admin` — scraper dashboard (Clerk-gated at admin email level in the page component)
- `lib/scrapers/` — `mercadolibre.ts` + `serpapi.ts` scrape listings from ML and Google Shopping
- `/api/admin/scrape` — triggers scrape runs
- `SCRAPER_AGENTS.md` — full scraper architecture doc (read if touching scrapers)
- `SUPPLY_IMPORT_SCHEMA.md` — CSV bulk-import schema doc

Supply import pipeline:
- `/supply` — seller-facing bulk import page  
- `/api/supply/*` — schema validation, batch creation, status polling
- `lib/supply.ts` — row normalization + validation

---

<a name="ucp"></a>
## UCP (Universal Commerce Protocol) — AI agent APIs

Enables AI agents (Claude, Gemini, etc.) to shop the marketplace natively.

| Endpoint | Purpose |
|---|---|
| `GET /api/ucp/manifest` | Discover the UCP capabilities |
| `GET /api/ucp/catalog` | Search listings (same params as `/l`) |
| `GET /api/ucp/catalog/[id]` | Single listing detail |
| `POST /api/ucp/checkout-session` | Create a checkout intent (returns payment options) |
| `GET /api/ucp/identity/[identifier]` | Buyer trust score (OmniReputation) |
| `POST /api/ucp/mcp` | MCP server endpoint for direct AI tool use |

Docs: `ucp-use-cases.json` has all use-case examples.
