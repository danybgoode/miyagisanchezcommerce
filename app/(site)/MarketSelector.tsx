import { BuyerCopyText } from '@/app/components/BuyerPresentationContext'
import Link from 'next/link'
import { MARKETS, MARKET_CODES, marketBasePath } from '@/lib/markets'
import { sellerLandingPath } from '@/lib/seller-acquisition'
import type { RootLanguage } from '@/lib/root-language'
import MarketRecommendation from './MarketRecommendation'
import RootLanguageSwitch from './RootLanguageSwitch'
import { PendingMark } from '@/app/components/LinkPending'

/**
 * The master-brand market selector, rendered by BOTH roots: `/` in Spanish and
 * `/en` in English.
 *
 * ── Why the same component serves two languages ──────────────────────────────
 * Every string here is a dictionary key read through `BuyerCopyText`, and the
 * dictionary is supplied by the route's own layout — `(site)` mounts the Mexican
 * market document, `(en-site)` the US one. So the language is a property of the
 * ROUTE, resolved on the server, and this file holds no locale branch at all. Two
 * copies of this markup, one per language, is the arrangement that drifts: the
 * second copy is the one that keeps the old brand name after a rename.
 *
 * The one thing that does vary by language is where the closing CTA goes, and it
 * is passed in rather than inferred, because it is a genuine product decision
 * (`sellerLandingPath`) and not a translation.
 *
 * ── Why this page holds no catalog, at all ───────────────────────────────────
 * A selector that previews Mexican products is not a selector — it is the Mexico
 * marketplace with a country menu bolted on, which is the exact "one marketplace
 * pretending to be the brand" conflation the market epic exists to remove. So:
 * zero listing reads, zero Medusa calls, zero Supabase calls.
 *
 * The HTML-level proof is `e2e/market-selector.browser.spec.ts` (`expect(
 * page.locator('[data-listing-id]')).toHaveCount(0)`). Note that the browser job is
 * NON-BLOCKING in CI, so the source-level check in
 * `e2e/market-route-population.spec.ts` (no `@/lib/{listings,medusa,supabase}`
 * import) is the part that actually gates.
 *
 * ── What the copy may and may not claim ──────────────────────────────────────
 * Mexico and the United States are operating marketplaces. Country context still
 * matters: inventory, prices and fulfillment are market-owned, and US direct
 * checkout remains unavailable until its separate rail ships. The selector says
 * exactly that instead of collapsing catalog availability into payment readiness.
 *
 * And the brand is "Miyagi Sánchez", in full, always — never "Miyagi", never
 * "Miyagi Market(s)". The markets are markets OF Miyagi Sánchez; they are not
 * separately branded products, and naming them as though they were is what turned
 * one brand into three on the platform's own front door.
 */
export default function MarketSelector({ language }: { language: RootLanguage }) {
  // Language picks which market's landing the closing CTA opens: the Spanish
  // document sends a seller to the Spanish landing, the English document to the
  // English one. Read from `sellerLandingPath` so this page can never be the place
  // that still points at a landing after the landing has moved.
  const sellHref = sellerLandingPath(language === 'en' ? 'us' : 'mx')

  return (
    <div className="max-w-3xl mx-auto px-4 py-10" data-testid="market-selector">
      <section style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <RootLanguageSwitch current={language} />
        </div>
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
        {/* The `{' '}` before the emphasized fragment is load-bearing, not tidiness:
            this sentence is assembled from three dictionary keys, and without it the
            first key's trailing word ran straight into the second — "LosMiyagi
            Markets". JSX does not insert whitespace between adjacent expressions. */}
        <p style={{ fontSize: 15, color: 'var(--fg-muted)', lineHeight: 1.5, margin: 0 }}>
          <BuyerCopyText copyKey="page.bf77921b" />{' '}
          <strong style={{ color: 'var(--fg)' }}><BuyerCopyText copyKey="page.881db298" /></strong>{' '}
          <BuyerCopyText copyKey="page.ac4888c2" /></p>
      </section>

      <section
        className="grid grid-cols-1 sm:grid-cols-2 gap-4"
        style={{ marginBottom: 32 }}
        data-testid="market-selector-choices"
      >
        {MARKET_CODES.map((code) => {
          const record = MARKETS[code]
          const open = record.marketplace_status === 'active'
          return (
            <Link
              key={code}
              href={marketBasePath(code)}
              data-testid={`market-choice-${code}`}
              className="card-tile no-underline block"
              style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              {/* Keeps the tile dimmed for the whole navigation, not just while the finger is down. */}
              <PendingMark showDot={false} />
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {/* The market's ISO code as a quiet monospace pill. `aria-hidden`
                    because the market's real name is the very next element —
                    a screen reader announcing "M X México" is noise.
                    Not a flag emoji: it renders as a completely different thing per
                    platform, it is a national flag standing in for a MARKET, and it
                    is the emoji-as-chrome the platform swept out everywhere else. */}
                <span
                  aria-hidden
                  data-testid={`market-code-${code}`}
                  style={{
                    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    lineHeight: 1,
                    padding: '5px 7px',
                    borderRadius: 'var(--r-sm)',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-sunk)',
                    color: 'var(--fg-muted)',
                  }}
                >
                  {code.toUpperCase()}
                </span>
                <span style={{ fontWeight: 600, fontSize: 17, color: 'var(--fg)' }}>
                  {code === 'mx'
                    ? <BuyerCopyText copyKey="page.marketCardMxName" />
                    : <BuyerCopyText copyKey="page.marketCardUsName" />}
                </span>
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
                {code === 'mx'
                  ? <BuyerCopyText copyKey="page.marketCardMxLede" />
                  : <BuyerCopyText copyKey="page.marketCardUsLede" />}
              </span>
              <span style={{ fontSize: 13.5, color: 'var(--accent)', fontWeight: 500 }}>
                {code === 'mx'
                  ? <BuyerCopyText copyKey="page.marketCardMxCta" />
                  : <BuyerCopyText copyKey="page.marketCardUsCta" />} →
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
        <Link href={sellHref} className="btn btn-primary btn-sm" data-testid="market-selector-sell-cta">
          <BuyerCopyText copyKey="page.b5f692e9" /></Link>
      </section>
    </div>
  )
}
