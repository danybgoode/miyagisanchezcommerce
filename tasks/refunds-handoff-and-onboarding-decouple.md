# Plan — (1) Refund/return agent handoff & (2) Decouple shop creation from listing creation

> Validated against the live code on `main` (commit `bcf6a9d`). Memory was stale in places;
> this plan reflects what's actually in the repo today.

## Ground truth (what the code actually is)

**Refunds/returns** — there is **no `/account/refunds` page**. The whole flow lives on the
order pages and is already wired end-to-end through Medusa + a Supabase legacy fallback:

- Buyer: [`app/account/orders/[id]/OrderTrackingClient.tsx`](app/account/orders/[id]/OrderTrackingClient.tsx)
  - "Solicitar devolución" form (lines ~527–578): reason radios + a **`returnDesc` "Descripción (opcional)" textarea** → this is the buyer-side "nota adicional".
  - Posts to `POST /api/orders/[id]/return-request`.
- Seller: [`app/shop/manage/orders/[id]/OrderDetail.tsx`](app/shop/manage/orders/[id]/OrderDetail.tsx)
  - Return panel (lines ~879–970): **`returnSellerNote` "Nota para el comprador (opcional)" textarea** → this is the seller-side "nota adicional" — plus Reembolso total / Parcial / Rechazar buttons.
  - Posts to `PATCH /api/orders/[id]/return-request/[requestId]`.
- API: [`app/api/orders/[id]/return-request/route.ts`](app/api/orders/[id]/return-request/route.ts) — routes Medusa orders (`order_*`) to the backend, else Supabase. Sends emails via `sendReturnRequestToSeller` / `sendReturnRequestConfirmedToBuyer`.
- **Agent layer already exists**: [`app/components/AIAgentButton.tsx`](app/components/AIAgentButton.tsx) (copy-prompt + "Abrir en Claude" → `https://claude.ai/new?q=…`), the briefing page [`app/agent/page.tsx`](app/agent/page.tsx), the MCP server at `app/api/ucp/mcp/[transport]/route.ts`, and UCP return routes `app/api/ucp/orders/[id]/return-request` + `.../[requestId]/resolve`. So an agent can already create and resolve returns over MCP.

**Onboarding** — shop + listing are coupled in a single atomic call:

- [`app/sell/page.tsx`](app/sell/page.tsx) → looks up `marketplace_shops` (Supabase) by Clerk user → passes `existingShop` to the wizard.
- [`app/sell/SellWizard.tsx`](app/sell/SellWizard.tsx) → `hasShopStep = existingShop === null`. Step 1 (StepShop) collects shop fields **but does not persist them**; the shop is only created server-side inside `handleSubmit` → `POST /api/sell/create`, **at the same time as the first product**.
- [`app/api/sell/create/route.ts`](app/api/sell/create/route.ts) → if `/store/sellers/me` 404s, it creates the Medusa seller (lines ~111–146) **then** the product, then mirrors to Supabase.
- [`app/shop/manage/page.tsx`](app/shop/manage/page.tsx) → reads `/store/sellers/me`; **404 → `redirect('/sell')`**.
- [`app/api/sell/shop/route.ts`](app/api/sell/shop/route.ts) → currently **PATCH only** (settings update); no create.

**The broken state, precisely:** a user fills Step 1 (shop) and abandons before submitting the
listing → nothing is persisted → no Medusa seller → `/shop/manage` 404s and bounces to `/sell`,
which restarts them at Step 1. They can never reach their dashboard without publishing a listing.
`ManageDashboard` already has a correct empty state ("No tienes anuncios publicados"), so the
**only** real blocker is that the shop is never persisted on its own.

---

## Part 1 — Refund/return agent handoff (frontend, mirrors AIAgentButton)

Add a small reusable handoff control and drop it into both return surfaces. No backend changes —
the agent acts through the existing MCP/UCP routes.

### 1a. New component `app/components/AgentHandoff.tsx`
- Props: `{ prompt: string; buttonLabel?: string; title?: string; subtitle?: string }`.
- Reuses the exact visual pattern of `AIAgentButton` (prompt box + **Copiar prompt** + **Abrir en Claude** opening `https://claude.ai/new?q=${encodeURIComponent(prompt)}`, plus a small "Ficha del marketplace" link to `/agent`).
- Bilingual strings per AGENTS.md rule #5 (`locales/en.json` + `locales/es.json`).

### 1b. Buyer side — `OrderTrackingClient.tsx`
- Inside the "Solicitar devolución" form, **below the `returnDesc` textarea**, add an
  `<AgentHandoff>` with a buyer-scoped prompt, e.g.:
  > "Ayúdame a iniciar una devolución/reembolso en Miyagi Sánchez para mi pedido `{orderId}` (`{listingTitle}`). Lee la ficha del marketplace en https://miyagisanchez.com/agent, usa el MCP, propón un plan y ejecútalo: motivo, evidencia y monto. Mi pedido: https://miyagisanchez.com/account/orders/{orderId}"
- Also surface a short line of helper copy: agents can complete this for you.
- The prompt is built from props already on the page (`order.id`, `listing?.title`).

### 1c. Seller side — `OrderDetail.tsx`
- In the return panel, **below the `returnSellerNote` textarea**, add:
  - One line of copy: *"Los agentes pueden iniciar y resolver reembolsos por ti."*
  - An `<AgentHandoff>` with a seller-scoped prompt, e.g.:
    > "Soy el vendedor. Asísteme a resolver/iniciar un reembolso para el pedido `{orderId}` (`{listingTitle}`) en Miyagi Sánchez. Lee https://miyagisanchez.com/agent, usa el MCP, evalúa la solicitud del comprador y propón aceptar / parcial / rechazar con la nota al comprador; luego ejecútalo. Pedido: https://miyagisanchez.com/shop/manage/orders/{orderId}"
- **Decision needed (see Open questions):** "the seller wants to start a refund for a client."
  Today seller-initiated refunds without a buyer request aren't exposed in the UI. The handoff
  prompt covers it *via the agent/MCP*. If you also want a **non-agent** "Iniciar reembolso"
  button for the seller, that needs a small backend addition (a seller-initiated return endpoint).
  Proposed: ship the agent handoff now; treat the direct button as a follow-up.

---

## Part 2 — Decouple shop creation from listing creation

Goal: persist the shop the moment Step 1 is completed, so abandoning the listing still leaves a
reachable `/shop/manage`. Minimal, Medusa-owned (AGENTS.md rule #1).

### 2a. Add `POST` to `app/api/sell/shop/route.ts`
- New `POST` handler (file currently PATCH-only) that creates the Medusa seller via
  `POST /store/sellers/me` (same call `sell/create` already makes, lines ~130–146) + `ensureSupabaseShopMirror`.
- Idempotent: if `/store/sellers/me` already returns a seller, return it (no duplicate).
- Returns `{ shopSlug }`. Reuses validation already in `sell/create` (name ≥ 2 chars, location from city/state).

### 2b. `SellWizard.tsx` — persist on "Continuar"
- `handleShopNext` (line ~1311): after client validation, `await POST /api/sell/shop`. On success,
  flip local `hasShop` true and advance to Step 2. On failure, show the existing error UI.
- Because the seller now exists, `POST /api/sell/create` takes its existing "seller already exists"
  branch — `createShop` payload becomes a no-op (safe to keep or drop).

### 2c. Add an escape hatch on the listing step
- In `StepListing` actions (near line ~1120), add a secondary link **"Terminar después — ir a mi tienda"** → `/shop/manage` (now reachable). This is the direct fix for "no way to reach /shop/manage."

### 2d. Make `/sell` shop-detection authoritative (small hardening)
- `app/sell/page.tsx` currently detects an existing shop via Supabase `marketplace_shops`, while
  `/shop/manage` uses Medusa `/store/sellers/me`. Switch `/sell` to check `/store/sellers/me`
  (mirroring the manage page) so the two never diverge — a user with a Medusa seller but a missing
  Supabase mirror still skips Step 1. (Keep the Supabase read only if a name/location is needed for display.)

### Resulting flow
1. New seller → `/sell` → Step 1 → "Continuar" persists the shop → Step 2.
2. Abandon at Step 2 → shop already exists → `/shop/manage` loads with the empty-listings state, and "+ Nuevo anuncio" returns them to `/sell` Step 2.
3. Finish listing → unchanged success screen.

---

## Files touched
- **New:** `app/components/AgentHandoff.tsx`
- **Edit:** `app/account/orders/[id]/OrderTrackingClient.tsx` (buyer handoff)
- **Edit:** `app/shop/manage/orders/[id]/OrderDetail.tsx` (seller handoff + copy)
- **Edit:** `app/api/sell/shop/route.ts` (add POST create)
- **Edit:** `app/sell/SellWizard.tsx` (persist shop on Step 1; add escape hatch)
- **Edit:** `app/sell/page.tsx` (Medusa-authoritative shop detection)
- **Edit:** `locales/en.json` + `locales/es.json` (new strings, both required)

## Verification
- `npx tsc --noEmit`.
- Manual: new account → publish flow unchanged; abandon-after-shop now reaches `/shop/manage`;
  buyer & seller handoff buttons copy the right prompt and open Claude with order context.

## Open questions (will confirm before/while building)
1. **Seller-initiated refund button (non-agent):** ship agent-handoff only now, or also add the
   backend endpoint + button so a seller can start a refund without a buyer request? (Recommend: handoff now, button as follow-up.)
2. **Handoff destination** confirmed as claude.ai web chat via the existing MCP — same as `AIAgentButton`. Good to proceed.
