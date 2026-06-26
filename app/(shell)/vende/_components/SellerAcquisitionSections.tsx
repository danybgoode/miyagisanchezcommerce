import type { CSSProperties } from 'react'
import Link from 'next/link'
import type { SellerAcquisitionVariant } from '@/lib/seller-acquisition'
import { TrustPromptCopy } from './TrustPromptCopy'
import { SellerAcquisitionVariantTag } from './SellerAcquisitionVariantTag'

type LandingCta = {
  label: string
  href: string
  testId?: string
}

type LandingPoint = {
  icon: string
  title: string
  body: string
}

type LandingStep = {
  title: string
  body: string
}

type PersonaRouterCard = {
  eyebrow: string
  title: string
  body: string
  href: string
  icon: string
  statusLabel?: string
  testId?: string
}

type BenchmarkRow = {
  label: string
  miyagi: string
  mercadoLibre: string
  shopify: string
}

type LandingBenchmark = {
  title: string
  lead: string
  rowHeader: string
  columns: string[]
  rows: BenchmarkRow[]
  verified: string
  verifiedLabel: string
  footnote: string
}

export type SellerAcquisitionPageConfig = {
  pageId: string
  variant: SellerAcquisitionVariant
  eyebrow: string
  title: string
  lead: string
  trustLine: string
  trustPrompt: string
  copyLabel: string
  copiedLabel: string
  primaryCta: LandingCta
  secondaryCta?: LandingCta
  heroStats: Array<{ value: string; label: string }>
  proofTitle: string
  proofLead: string
  proofPoints: LandingPoint[]
  personaRouter?: {
    title: string
    lead: string
    cards: PersonaRouterCard[]
  }
  stepsTitle: string
  steps: LandingStep[]
  agentTitle: string
  agentBody: string
  socialTitle: string
  socialBody: string
  socialStats: Array<{ value: string; label: string }>
  faqTitle: string
  faqs: LandingStep[]
  closingTitle: string
  closingBody: string
  closingCta: LandingCta
  benchmark?: LandingBenchmark
}

export function SellerAcquisitionPage({ config }: { config: SellerAcquisitionPageConfig }) {
  return (
    <main
      className="app-shell"
      data-seller-persona={config.pageId}
      data-seller-variant={config.variant}
      style={{
        paddingTop: 'var(--s-8)',
        paddingBottom: 'var(--s-10)',
      }}
    >
      <SellerAcquisitionVariantTag persona={config.pageId} variant={config.variant} />
      <LandingHero config={config} />
      <ProofSection config={config} />
      {config.benchmark ? <BenchmarkSection benchmark={config.benchmark} pageId={config.pageId} /> : null}
      {config.personaRouter ? <PersonaRouterSection router={config.personaRouter} pageId={config.pageId} /> : null}
      <StepsSection config={config} />
      <SocialProofSection config={config} />
      <FaqSection config={config} />
      <ClosingCta config={config} />
    </main>
  )
}

function LandingHero({ config }: { config: SellerAcquisitionPageConfig }) {
  return (
    <section
      aria-labelledby={`${config.pageId}-hero-title`}
      style={{
        display: 'grid',
        gap: 'var(--s-7)',
        alignItems: 'center',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
        marginBottom: 'var(--s-10)',
      }}
    >
      <div>
        <span className="badge badge-agent" style={{ marginBottom: 'var(--s-4)' }}>
          {config.eyebrow}
        </span>
        <h1
          id={`${config.pageId}-hero-title`}
          className="t-h1"
          style={{
            fontSize: 'var(--t-4xl)',
            letterSpacing: 0,
            marginBottom: 'var(--s-4)',
            maxWidth: 680,
          }}
        >
          {config.title}
        </h1>
        <p className="t-lead" style={{ maxWidth: 660, marginBottom: 'var(--s-5)' }}>
          {config.lead}
        </p>
        <TrustSpine config={config} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-3)', alignItems: 'center' }}>
          <Link
            href={config.primaryCta.href}
            className="btn btn-primary btn-lg"
            data-testid={config.primaryCta.testId}
            prefetch={false}
          >
            {config.primaryCta.label}
            <i className="iconoir-arrow-right" aria-hidden="true" />
          </Link>
          {config.secondaryCta ? (
            <Link href={config.secondaryCta.href} className="btn btn-secondary btn-lg" prefetch={false}>
              {config.secondaryCta.label}
            </Link>
          ) : null}
        </div>
      </div>

      <aside
        aria-label={config.socialTitle}
        className="card-panel"
        style={{
          padding: 'var(--s-5)',
          boxShadow: 'var(--shadow-2)',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 'var(--s-2)',
            marginBottom: 'var(--s-5)',
          }}
        >
          {config.heroStats.map((stat) => (
            <div
              key={stat.label}
              style={{
                background: 'var(--bg-sunk)',
                borderRadius: 'var(--r-md)',
                padding: 'var(--s-3)',
                minHeight: 88,
              }}
            >
              <strong style={{ display: 'block', color: 'var(--accent)', fontSize: 24, lineHeight: 1 }}>
                {stat.value}
              </strong>
              <span className="t-caption" style={{ display: 'block', marginTop: 'var(--s-2)' }}>
                {stat.label}
              </span>
            </div>
          ))}
        </div>
        <h2 className="t-h3" style={{ letterSpacing: 0, marginBottom: 'var(--s-3)' }}>
          {config.agentTitle}
        </h2>
        <p className="t-small" style={{ color: 'var(--fg-muted)' }}>
          {config.agentBody}
        </p>
      </aside>
    </section>
  )
}

function TrustSpine({ config }: { config: SellerAcquisitionPageConfig }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--s-3)',
        alignItems: 'center',
        color: 'var(--agent)',
        background: 'var(--agent-soft)',
        border: '1px solid var(--anil-100)',
        borderRadius: 'var(--r-md)',
        padding: 'var(--s-3) var(--s-4)',
        lineHeight: 1.55,
        fontSize: 14,
        maxWidth: 660,
        marginBottom: 'var(--s-5)',
      }}
    >
      <span style={{ flex: '1 1 260px' }}>
        <i className="iconoir-sparks" aria-hidden="true" style={{ marginRight: 'var(--s-2)' }} />
        {config.trustLine}
      </span>
      <TrustPromptCopy
        prompt={config.trustPrompt}
        copyLabel={config.copyLabel}
        copiedLabel={config.copiedLabel}
        testId={`${config.pageId}-trust-copy`}
      />
    </div>
  )
}

function ProofSection({ config }: { config: SellerAcquisitionPageConfig }) {
  return (
    <section aria-labelledby={`${config.pageId}-proof-title`} style={{ marginBottom: 'var(--s-10)' }}>
      <SectionIntro id={`${config.pageId}-proof-title`} title={config.proofTitle} lead={config.proofLead} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))',
          gap: 'var(--s-3)',
        }}
      >
        {config.proofPoints.map((point) => (
          <article key={point.title} className="card-panel" style={{ padding: 'var(--s-5)' }}>
            <i
              className={point.icon}
              aria-hidden="true"
              style={{ color: 'var(--accent)', fontSize: 28, display: 'block', marginBottom: 'var(--s-4)' }}
            />
            <h3 className="t-h4" style={{ letterSpacing: 0, marginBottom: 'var(--s-2)' }}>
              {point.title}
            </h3>
            <p className="t-small" style={{ color: 'var(--fg-muted)' }}>
              {point.body}
            </p>
          </article>
        ))}
      </div>
    </section>
  )
}

function PersonaRouterSection({
  router,
  pageId,
}: {
  router: NonNullable<SellerAcquisitionPageConfig['personaRouter']>
  pageId: string
}) {
  return (
    <section aria-labelledby={`${pageId}-router-title`} style={{ marginBottom: 'var(--s-10)' }}>
      <SectionIntro id={`${pageId}-router-title`} title={router.title} lead={router.lead} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
          gap: 'var(--s-3)',
        }}
      >
        {router.cards.map((card) => (
          <Link
            key={card.title}
            href={card.href}
            className="card-tile"
            data-testid={card.testId}
            prefetch={false}
            style={{ padding: 'var(--s-5)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s-3)' }}>
              <span className="badge badge-soft">{card.eyebrow}</span>
              {card.statusLabel ? <span className="badge badge-warning">{card.statusLabel}</span> : null}
            </div>
            <i
              className={card.icon}
              aria-hidden="true"
              style={{ color: 'var(--accent)', fontSize: 30, display: 'block', marginTop: 'var(--s-5)' }}
            />
            <h3 className="t-h4" style={{ letterSpacing: 0, marginTop: 'var(--s-4)', marginBottom: 'var(--s-2)' }}>
              {card.title}
            </h3>
            <p className="t-small" style={{ color: 'var(--fg-muted)' }}>
              {card.body}
            </p>
          </Link>
        ))}
      </div>
    </section>
  )
}

function StepsSection({ config }: { config: SellerAcquisitionPageConfig }) {
  return (
    <section
      aria-labelledby={`${config.pageId}-steps-title`}
      style={{
        display: 'grid',
        gap: 'var(--s-7)',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
        alignItems: 'start',
        marginBottom: 'var(--s-10)',
      }}
    >
      <div>
        <h2 id={`${config.pageId}-steps-title`} className="t-h2" style={{ letterSpacing: 0, marginBottom: 'var(--s-5)' }}>
          {config.stepsTitle}
        </h2>
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--s-4)' }}>
          {config.steps.map((step, index) => (
            <li
              key={step.title}
              style={{
                display: 'grid',
                gridTemplateColumns: '40px 1fr',
                gap: 'var(--s-3)',
                alignItems: 'start',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 40,
                  height: 40,
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
                <strong style={{ display: 'block', color: 'var(--fg)', marginBottom: 'var(--s-1)' }}>
                  {step.title}
                </strong>
                <span className="t-small" style={{ display: 'block', color: 'var(--fg-muted)' }}>
                  {step.body}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <aside
        style={{
          borderLeft: '4px solid var(--agent)',
          background: 'var(--agent-soft)',
          borderRadius: 'var(--r-md)',
          padding: 'var(--s-5)',
        }}
      >
        <h2 className="t-h3" style={{ color: 'var(--agent)', letterSpacing: 0, marginBottom: 'var(--s-2)' }}>
          {config.agentTitle}
        </h2>
        <p className="t-small" style={{ color: 'var(--agent)' }}>
          {config.agentBody}
        </p>
      </aside>
    </section>
  )
}

function SocialProofSection({ config }: { config: SellerAcquisitionPageConfig }) {
  return (
    <section aria-labelledby={`${config.pageId}-social-title`} style={{ marginBottom: 'var(--s-10)' }}>
      <div
        className="card-panel"
        style={{
          display: 'grid',
          gap: 'var(--s-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
          padding: 'var(--s-6)',
          background: 'var(--bg-sunk)',
        }}
      >
        <div>
          <h2 id={`${config.pageId}-social-title`} className="t-h2" style={{ letterSpacing: 0, marginBottom: 'var(--s-2)' }}>
            {config.socialTitle}
          </h2>
          <p className="t-lead">{config.socialBody}</p>
        </div>
        <div
          style={{
            display: 'grid',
            gap: 'var(--s-3)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          }}
        >
          {config.socialStats.map((stat) => (
            <div key={stat.label} style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--s-3)' }}>
              <strong style={{ display: 'block', color: 'var(--accent)', fontSize: 26, lineHeight: 1 }}>
                {stat.value}
              </strong>
              <span className="t-caption" style={{ display: 'block', marginTop: 'var(--s-2)' }}>
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FaqSection({ config }: { config: SellerAcquisitionPageConfig }) {
  return (
    <section aria-labelledby={`${config.pageId}-faq-title`} style={{ marginBottom: 'var(--s-10)' }}>
      <h2 id={`${config.pageId}-faq-title`} className="t-h2" style={{ letterSpacing: 0, marginBottom: 'var(--s-5)' }}>
        {config.faqTitle}
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))',
          gap: 'var(--s-3)',
        }}
      >
        {config.faqs.map((faq) => (
          <article key={faq.title} className="card-panel" style={{ padding: 'var(--s-5)' }}>
            <h3 className="t-h4" style={{ letterSpacing: 0, marginBottom: 'var(--s-2)' }}>
              {faq.title}
            </h3>
            <p className="t-small" style={{ color: 'var(--fg-muted)' }}>
              {faq.body}
            </p>
          </article>
        ))}
      </div>
    </section>
  )
}

function ClosingCta({ config }: { config: SellerAcquisitionPageConfig }) {
  return (
    <section
      aria-labelledby={`${config.pageId}-closing-title`}
      style={{
        borderTop: '1px solid var(--border)',
        paddingTop: 'var(--s-7)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--s-5)',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <div style={{ maxWidth: 680 }}>
        <h2 id={`${config.pageId}-closing-title`} className="t-h2" style={{ letterSpacing: 0, marginBottom: 'var(--s-2)' }}>
          {config.closingTitle}
        </h2>
        <p className="t-lead">{config.closingBody}</p>
      </div>
      <Link
        href={config.closingCta.href}
        className="btn btn-primary btn-lg"
        data-testid={config.closingCta.testId}
        prefetch={false}
      >
        {config.closingCta.label}
        <i className="iconoir-arrow-right" aria-hidden="true" />
      </Link>
    </section>
  )
}

function BenchmarkSection({
  benchmark,
  pageId,
}: {
  benchmark: NonNullable<SellerAcquisitionPageConfig['benchmark']>
  pageId: string
}) {
  const cellBase: CSSProperties = {
    padding: 'var(--s-3)',
    verticalAlign: 'top',
    borderBottom: '1px solid var(--border)',
    textAlign: 'left',
  }

  return (
    <section aria-labelledby={`${pageId}-benchmark-title`} style={{ marginBottom: 'var(--s-10)' }}>
      <SectionIntro id={`${pageId}-benchmark-title`} title={benchmark.title} lead={benchmark.lead} />
      <div
        className="card-panel"
        style={{ padding: 'var(--s-2)', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
      >
        <table style={{ width: '100%', minWidth: 680, borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              <th scope="col" style={{ ...cellBase, color: 'var(--fg-muted)', fontWeight: 600 }}>
                {benchmark.rowHeader}
              </th>
              {benchmark.columns.map((col, index) => (
                <th
                  key={col}
                  scope="col"
                  style={{
                    ...cellBase,
                    fontWeight: 700,
                    color: index === 0 ? 'var(--accent)' : 'var(--fg)',
                    background: index === 0 ? 'var(--bg-sunk)' : 'transparent',
                  }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {benchmark.rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" style={{ ...cellBase, color: 'var(--fg)', fontWeight: 600 }}>
                  {row.label}
                </th>
                <td style={{ ...cellBase, color: 'var(--fg)', fontWeight: 600, background: 'var(--bg-sunk)' }}>
                  {row.miyagi}
                </td>
                <td style={{ ...cellBase, color: 'var(--fg-muted)' }}>{row.mercadoLibre}</td>
                <td style={{ ...cellBase, color: 'var(--fg-muted)' }}>{row.shopify}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--s-2)',
          alignItems: 'center',
          marginTop: 'var(--s-3)',
        }}
      >
        <span className="badge badge-verified" data-testid={`${pageId}-benchmark-verified`}>
          {benchmark.verifiedLabel}: {benchmark.verified}
        </span>
        <p className="t-caption" style={{ color: 'var(--fg-muted)', margin: 0, flex: '1 1 260px' }}>
          {benchmark.footnote}
        </p>
      </div>
    </section>
  )
}

function SectionIntro({ id, title, lead }: { id: string; title: string; lead: string }) {
  return (
    <div style={{ maxWidth: 700, marginBottom: 'var(--s-5)' }}>
      <h2 id={id} className="t-h2" style={{ letterSpacing: 0, marginBottom: 'var(--s-2)' }}>
        {title}
      </h2>
      <p className="t-lead">{lead}</p>
    </div>
  )
}
