import { BuyerCopyText } from '@/app/components/BuyerPresentationContext'
import Link from 'next/link'
import type { Metadata } from 'next'
import { MARKETS, MARKET_CODES, marketBasePath } from '@/lib/markets'
import { marketLandingMetadata, selectorMetadata } from '@/lib/market-seo'
import MarketRecommendation from './MarketRecommendation'

/**
 * `/` — the master-brand market selector.
 *
 * Epic 07 · market-architecture-foundation, Story 2.1 (decision D7). Until this
 * cutover, `/` WAS the Mexico marketplace homepage; it now lives at `/mx`
 * (`app/(site)/mx/page.tsx`, moved verbatim) and this page took its place.
 *
 * ── Why this page holds no catalog, at all ───────────────────────────────────
 * A selector that previews Mexican products is not a selector — it is the
 * Mexico marketplace with a country menu bolted on, which is the exact "one
 * marketplace pretending to be the brand" conflation the epic exists to remove.
 * So: zero listing reads, zero Medusa calls, zero Supabase calls.
 *
 * The HTML-level proof is `e2e/market-selector.browser.spec.ts` (`expect(
 * page.locator('[data-listing-id]')).toHaveCount(0)`). This comment used to cite
 * `e2e/market-routes.spec.ts`, which has never existed in this repo's history —
 * a citation to a nonexistent guard reads exactly like a guarded property, which
 * is worse than no citation. Note that the browser job is NON-BLOCKING in CI, so
 * the source-level check in `e2e/market-route-population.spec.ts` (no
 * `@/lib/{listings,medusa,supabase}` import) is the part that actually gates.
 *
 * ── What the copy may and may not claim ──────────────────────────────────────
 * Mexico is an operating marketplace. The United States is an invitation-only
 * private pilot (`lib/markets.ts` → `marketplace_status: 'invitation'`), and
 * there is no US Medusa Region, no USD price, no US payment or shipping
 * capability (D0). The copy therefore describes what a shop is (borderless,
 * yours, no marketplace admission needed) and what a Miyagi Market is
 * (country-specific, currently Mexico), and claims no worldwide operational
 * readiness anywhere. The US card says "por invitación" in its own label so the
 * status is legible before the click, not after it.
 *
 * The Spanish copy is deliberate: `AGENTS.md` rule 5 — es-MX is the default and
 * this surface is not on the bilingual allow-list. Sprint 3's `/us` page is the
 * English surface.
 */

/**
 * The page holds no data, so this window is NOT about content freshness — it is
 * about the build-scoped asset URLs the HTML embeds.
 *
 * This page used to carry no `revalidate` at all, reasoned from "there is
 * nothing here that can go stale". That reasoning was wrong, and it broke the
 * homepage in production (2026-08-06): a prerender with no `revalidate` is
 * served with `s-maxage=31536000`, Cloudflare cached `/` on that one-year TTL,
 * and the HTML kept pointing at `/_next/static/chunks/*` hashes from the build
 * that produced it. Those chunks are deleted the moment a new Cloud Run
 * revision takes over, so the edge served a 7-day-old document whose CSS 404'd
 * — an unstyled homepage, while every other route (all of which do carry a
 * `revalidate`) rendered fine.
 *
 * The content is static; the asset hashes are not. A page is only as cacheable
 * as the shortest-lived thing its HTML references. 60s matches `/mx` and, with
 * Next's `stale-while-revalidate`, bounds post-deploy breakage to roughly one
 * request instead of a year.
 */
export const revalidate = 60

export const metadata: Metadata = {
  title: 'Miyagi Sánchez — Tu tienda propia y los mercados por país',
  description:
    'Abre tu propia tienda con Miyagi y véndele a quien quieras. Los Miyagi Markets son por país: México está activo; Estados Unidos es un piloto por invitación.',
  ...selectorMetadata(),
}

/** Per-market selector copy. Status/locale facts come from the registry, never restated here. */
const MARKET_CARDS: Record<(typeof MARKET_CODES)[number], {
  flag: string
  name: string
  lede: string
  cta: string
  href: string
}> = {
  mx: {
    flag: '🇲🇽',
    name: 'México',
    lede: 'El mercado Miyagi activo. Compra y vende en pesos, con pago protegido, envíos y entrega local.',
    cta: 'Entrar a Miyagi México',
    href: marketBasePath('mx'),
  },
  us: {
    flag: '🇺🇸',
    name: 'Estados Unidos',
    lede: 'Piloto privado por invitación. Todavía no hay mercado abierto ni checkout en dólares.',
    cta: 'Conocer el piloto',
    href: marketBasePath('us'),
  },
}

export default function MarketSelectorPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-10" data-testid="market-selector">
      <section style={{ textAlign: 'center', marginBottom: 32 }}>
        <h1
          style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 700,
            fontSize: 'var(--t-xl, 24px)',
            color: 'var(--fg)',
            lineHeight: 1.25,
            margin: '0 0 12px',
          }}
        >
          <BuyerCopyText copyKey="page.5b78d70c" /></h1>
        <p style={{ fontSize: 15, color: 'var(--fg-muted)', lineHeight: 1.5, margin: 0 }}>
          <BuyerCopyText copyKey="page.bf77921b" /><strong style={{ color: 'var(--fg)' }}><BuyerCopyText copyKey="page.881db298" /></strong> <BuyerCopyText copyKey="page.ac4888c2" /></p>
      </section>

      <section
        className="grid grid-cols-1 sm:grid-cols-2 gap-4"
        style={{ marginBottom: 32 }}
        data-testid="market-selector-choices"
      >
        {MARKET_CODES.map((code) => {
          const card = MARKET_CARDS[code]
          const record = MARKETS[code]
          const open = record.marketplace_status === 'active'
          return (
            <Link
              key={code}
              href={card.href}
              data-testid={`market-choice-${code}`}
              className="card-tile no-underline block"
              style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span aria-hidden style={{ fontSize: 26 }}>{card.flag}</span>
                <span style={{ fontWeight: 600, fontSize: 17, color: 'var(--fg)' }}>{card.name}</span>
                <span
                  className="badge badge-soft"
                  data-testid={`market-status-${code}`}
                  style={{ fontSize: 11 }}
                >
                  {open ? <BuyerCopyText copyKey="page.89b515ec" /> : <BuyerCopyText copyKey="page.7aa89a8b" />}
                </span>
                <MarketRecommendation market={code} />
              </span>
              <span style={{ fontSize: 13.5, color: 'var(--fg-muted)', lineHeight: 1.45 }}>
                {card.lede}
              </span>
              <span style={{ fontSize: 13.5, color: 'var(--accent)', fontWeight: 500 }}>
                {card.cta} →
              </span>
            </Link>
          )
        })}
      </section>

      <section className="card-panel" style={{ padding: 18 }}>
        <h2 style={{ fontWeight: 600, fontSize: 'var(--t-base)', color: 'var(--fg)', marginBottom: 8 }}>
          <BuyerCopyText copyKey="page.7b6fe1dd" /></h2>
        <p style={{ fontSize: 13.5, color: 'var(--fg-muted)', lineHeight: 1.5, marginBottom: 12 }}>
          <BuyerCopyText copyKey="page.3cc39e5f" /></p>
        <Link href="/vende" className="btn btn-primary btn-sm" data-testid="market-selector-sell-cta">
          <BuyerCopyText copyKey="page.b5f692e9" /></Link>
      </section>
    </div>
  )
}

// Referenced so a future edit that drops the market-landing metadata helper from
// this tree fails the type check rather than silently un-canonicalizing `/mx`.
export type MarketLandingMetadata = ReturnType<typeof marketLandingMetadata>
