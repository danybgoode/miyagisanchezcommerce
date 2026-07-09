import type { Metadata } from 'next'
import Link from 'next/link'
import es from '@/locales/es.json'
import { getOverriddenDictionary } from '@/lib/copy-overrides'
import {
  resolveSellerAcquisitionVariant,
  sellerPersonaCtaHref,
  sellerTrustPrompt,
} from '@/lib/seller-acquisition'
import { SellerAcquisitionVariantTag } from '../_components/SellerAcquisitionVariantTag'
import { PromptBlock } from '../_components/PromptBlock'
import { applySellerAcquisitionPageVariant } from '../_components/page-config'

const BASE_URL = 'https://miyagisanchez.com'
const PAGE_PATH = '/vende/mundial'

const meta = es.sellerAcquisition.mundial.metadata

// No manual `images` field — the sibling `opengraph-image.tsx` is auto-detected by Next's
// file-convention metadata resolution. A hardcoded `${PAGE_PATH}/opengraph-image` URL 404s:
// Next serves these at a content-hashed path (e.g. `/vende/mundial/opengraph-image-<hash>`).
export const metadata: Metadata = {
  title: meta.title,
  description: meta.description,
  alternates: { canonical: `${BASE_URL}${PAGE_PATH}` },
  openGraph: {
    type: 'website',
    locale: 'es_MX',
    url: `${BASE_URL}${PAGE_PATH}`,
    siteName: 'Miyagi Sánchez',
    title: meta.title,
    description: meta.description,
  },
  twitter: {
    card: 'summary_large_image',
    title: meta.title,
    description: meta.description,
  },
}

type MundialPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function MundialSellerPage({ searchParams }: MundialPageProps) {
  const query = await searchParams
  const variant = resolveSellerAcquisitionVariant(query)
  const sellerAcquisition = (await getOverriddenDictionary('es')).sellerAcquisition
  const ui = applySellerAcquisitionPageVariant(sellerAcquisition.mundial, variant)
  const selfCheck = sellerAcquisition.shared.selfCheck
  const sellCta = sellerPersonaCtaHref('mundial', query)
  const trustPrompt = sellerTrustPrompt('mundial', sellerAcquisition.shared.trustPrompt)
  const copyLabel = sellerAcquisition.shared.copyPrompt
  const copiedLabel = sellerAcquisition.shared.copiedPrompt

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: meta.title,
    description: meta.description,
    url: `${BASE_URL}${PAGE_PATH}`,
    inLanguage: 'es-MX',
    isPartOf: {
      '@type': 'WebSite',
      name: 'Miyagi Sánchez',
      url: BASE_URL,
    },
    potentialAction: {
      '@type': 'CreateAction',
      name: ui.primaryCta,
      target: `${BASE_URL}${sellCta}`,
    },
  }

  return (
    <main
      className="app-shell"
      data-seller-persona="mundial"
      data-seller-variant={variant}
      style={{ paddingTop: 36, paddingBottom: 72 }}
    >
      <SellerAcquisitionVariantTag persona="mundial" variant={variant} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <section
        aria-labelledby="mundial-hero-title"
        style={{
          display: 'grid',
          gap: 28,
          alignItems: 'center',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
          marginBottom: 56,
        }}
      >
        <div>
          <h1
            id="mundial-hero-title"
            className="t-h1"
            style={{
              fontSize: 'clamp(var(--t-2xl), 7vw, var(--t-4xl))',
              letterSpacing: 0,
              marginBottom: 14,
              maxWidth: 620,
              overflowWrap: 'break-word',
            }}
          >
            {ui.heroTitle}
          </h1>
          <p className="t-lead" style={{ maxWidth: 610, marginBottom: 18 }}>
            {ui.heroLead}
          </p>
          <p
            style={{
              color: 'var(--agent)',
              background: 'var(--agent-soft)',
              border: '1px solid var(--anil-100)',
              borderRadius: 'var(--r-md)',
              padding: '12px 14px',
              lineHeight: 1.55,
              fontSize: 14,
              maxWidth: 610,
              marginBottom: 18,
            }}
          >
            <i className="iconoir-sparks" aria-hidden="true" style={{ marginRight: 6 }} />
            {ui.trustLine}
          </p>
          <div style={{ maxWidth: 610, marginBottom: 22 }}>
            <PromptBlock
              prompt={trustPrompt}
              copyLabel={copyLabel}
              copiedLabel={copiedLabel}
              testId="mundial-prompt-copy"
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <Link
              href={sellCta}
              className="btn btn-primary btn-lg"
              data-testid="mundial-primary-cta"
              prefetch={false}
            >
              {ui.primaryCta}
              <i className="iconoir-arrow-right" aria-hidden="true" />
            </Link>
            <Link href="/agent" className="btn btn-agent btn-lg">
              {ui.secondaryCta}
            </Link>
          </div>
        </div>

        <div
          aria-label={ui.demandTitle}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            background: 'var(--bg-elevated)',
            boxShadow: 'var(--shadow-2)',
            padding: 18,
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 8,
              marginBottom: 18,
            }}
          >
            {ui.heroStats.map((stat) => (
              <div
                key={stat.label}
                style={{
                  background: 'var(--bg-sunk)',
                  borderRadius: 'var(--r-md)',
                  padding: '12px 10px',
                  minHeight: 86,
                  minWidth: 0,
                }}
              >
                <strong
                  style={{
                    display: 'block',
                    color: 'var(--accent)',
                    fontSize: 22,
                    lineHeight: 1,
                    overflowWrap: 'break-word',
                  }}
                >
                  {stat.value}
                </strong>
                <span className="t-caption" style={{ display: 'block', marginTop: 8 }}>
                  {stat.label}
                </span>
              </div>
            ))}
          </div>
          <h2 className="t-h3" style={{ letterSpacing: 0, marginBottom: 12 }}>
            {ui.demandTitle}
          </h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
            {ui.demandItems.map((item) => (
              <li
                key={item}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 14px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)',
                  color: 'var(--fg)',
                  background: 'var(--papel-50)',
                }}
              >
                <i className="iconoir-check-circle" aria-hidden="true" style={{ color: 'var(--accent)' }} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="mundial-proof-title" style={{ marginBottom: 56 }}>
        <div style={{ maxWidth: 680, marginBottom: 22 }}>
          <h2 id="mundial-proof-title" className="t-h2" style={{ letterSpacing: 0, marginBottom: 8 }}>
            {ui.proofTitle}
          </h2>
          <p className="t-lead">{ui.proofLead}</p>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))',
            gap: 12,
          }}
        >
          {ui.proofPoints.map((point) => (
            <article key={point.title} className="card-panel" style={{ padding: 18 }}>
              <i
                className={point.icon}
                aria-hidden="true"
                style={{ color: 'var(--accent)', fontSize: 28, display: 'block', marginBottom: 14 }}
              />
              <h3 className="t-h4" style={{ letterSpacing: 0, marginBottom: 8 }}>
                {point.title}
              </h3>
              <p className="t-small" style={{ color: 'var(--fg-muted)', lineHeight: 1.55 }}>
                {point.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="mundial-steps-title"
        style={{
          display: 'grid',
          gap: 26,
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
          alignItems: 'start',
          marginBottom: 56,
        }}
      >
        <div>
          <h2 id="mundial-steps-title" className="t-h2" style={{ letterSpacing: 0, marginBottom: 16 }}>
            {ui.stepsTitle}
          </h2>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
            {ui.steps.map((step, index) => (
              <li
                key={step.title}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '36px 1fr',
                  gap: 12,
                  alignItems: 'start',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 36,
                    height: 36,
                    borderRadius: 'var(--r-pill)',
                    background: 'var(--accent)',
                    color: 'var(--fg-inverse)',
                    fontWeight: 700,
                    fontSize: 14,
                  }}
                >
                  {index + 1}
                </span>
                <span>
                  <strong style={{ display: 'block', color: 'var(--fg)', marginBottom: 3 }}>
                    {step.title}
                  </strong>
                  <span style={{ color: 'var(--fg-muted)', lineHeight: 1.55, fontSize: 14 }}>
                    {step.body}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <aside style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <div>
            <h2 className="t-h3" style={{ color: 'var(--agent)', letterSpacing: 0, marginBottom: 8 }}>
              {selfCheck.title}
            </h2>
            <p style={{ color: 'var(--fg-muted)', lineHeight: 1.6, fontSize: 14 }}>
              {selfCheck.body}
            </p>
          </div>
          <PromptBlock
            prompt={trustPrompt}
            copyLabel={copyLabel}
            copiedLabel={copiedLabel}
            testId="mundial-steps-prompt-copy"
          />
        </aside>
      </section>

      <section
        aria-labelledby="mundial-closing-title"
        style={{
          borderTop: '1px solid var(--border)',
          paddingTop: 28,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 18,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ maxWidth: 660 }}>
          <h2 id="mundial-closing-title" className="t-h2" style={{ letterSpacing: 0, marginBottom: 8 }}>
            {ui.closingTitle}
          </h2>
          <p className="t-lead">{ui.closingBody}</p>
        </div>
        <Link
          href={sellCta}
          className="btn btn-primary btn-lg"
          data-testid="mundial-closing-cta"
          prefetch={false}
        >
          {ui.closingCta}
          <i className="iconoir-arrow-right" aria-hidden="true" />
        </Link>
      </section>
    </main>
  )
}
