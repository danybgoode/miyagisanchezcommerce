import Link from 'next/link'
import type { Metadata } from 'next'
import { marketLandingMetadata } from '@/lib/market-seo'
import { recruitingV3Enabled } from '@/lib/recruiting-v3'
import { FoundingOperatorApplication, RecruitingTrackLink } from './FoundingOperatorApplication'
import { coarseRecruitingSource } from '@/lib/recruiting-source'
import type { RecruitingSource } from '@/lib/recruiting-events'
import { getDictionary, type Dictionary } from '@/lib/dictionary'

/**
 * The US market exists as an invitation surface, not as a catalog.
 *
 * There are deliberately no child routes under this directory. That makes a
 * Mexico product id under `/us/l/...` an ordinary structural 404, and keeps the
 * invitation state honest without a runtime filter or an empty-looking catalog.
 */
export const metadata: Metadata = {
  title: 'Miyagi Sánchez United States — Private pilot',
  description:
    'Miyagi Sánchez is preparing a private United States operator pilot. The US marketplace and checkout are not open.',
  ...marketLandingMetadata('us'),
}

// The production authority is runtime Golden Beans; never freeze the OFF default
// into a static build artifact or a later cohort flip would have no effect.
export const dynamic = 'force-dynamic'

export default async function UnitedStatesPilotPage({ searchParams }: { searchParams: Promise<{ source?: string | string[]; lang?: string | string[] }> }) {
  const query = await searchParams
  const source = coarseRecruitingSource(query.source)
  const locale: 'en' | 'es' = query.lang === 'es' ? 'es' : 'en'
  if (await recruitingV3Enabled()) {
    const copy = (await getDictionary(locale)).partnersRecruiting
    return <MiyagiPartnersRecruitingPage source={source} lang={locale} copy={copy} />
  }
  return <LegacyUnitedStatesPilotPage />
}

function LegacyUnitedStatesPilotPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-14 sm:py-20" data-testid="us-invitation">
      <div className="max-w-2xl">
        <p className="badge badge-soft mb-5">Private pilot · research invitation</p>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)] mb-3">
          Working hypothesis · United States
        </p>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.05] mb-5">
          Run distinctive independent-product shops as one operating practice.
        </h1>
        <p className="text-lg text-[var(--color-muted)] leading-8 mb-5">
          We are looking for owner-led agencies and operators who steward roughly three to twenty
          independent-product brands on Shopify or WooCommerce today. The research question is
          whether one agent-connected commerce system can make the repeated operating work across
          those shops more legible and safer to run.
        </p>
        <p className="text-[var(--color-muted)] leading-7 mb-8">
          This is a hypothesis to test in conversations, not a public product launch. A merchant&apos;s
          owned shop remains its own channel; a country marketplace opens only when its local
          commerce rails are ready.
        </p>

        <section
          className="border-y border-[var(--color-border)] py-5 mb-8"
          aria-labelledby="us-pilot-proof-heading"
          data-testid="us-pilot-proof"
        >
          <p id="us-pilot-proof-heading" className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)] mb-4">
            The first proof we are seeking
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
            <ProofStep label="One operator" detail="A specialist team with real recurring shop work." />
            <span className="hidden sm:block text-[var(--color-muted)]" aria-hidden="true">→</span>
            <ProofStep label="Three consenting client shops" detail="Real merchants, explicit access, and shared learning." />
            <span className="hidden sm:block text-[var(--color-muted)]" aria-hidden="true">→</span>
            <ProofStep label="One operating system" detail="A pilot to evaluate, not a parity promise." />
          </div>
        </section>

        <div className="flex flex-wrap gap-3">
          <a
            href="mailto:daniel@miyagisanchez.com?subject=US%20operator%20pilot%20research"
            className="btn btn-primary no-underline"
            data-testid="us-research-cta"
          >
            Request a research conversation
          </a>
          <Link href="/" className="btn btn-secondary no-underline">
            Choose another market
          </Link>
        </div>
      </div>

      <aside className="max-w-2xl mt-12 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-5 text-sm text-[var(--color-muted)] leading-6">
        <strong className="block text-[var(--color-fg)] mb-1">What is not available yet</strong>
        There is no open US marketplace, catalog, dollar checkout, shipping, payment promise, or
        self-service availability claim. We are not claiming Amazon, eBay, Walmart, accounting,
        Veeqo, or ShipStation parity before the interviews establish the pilot&apos;s real need.
      </aside>
    </main>
  )
}

type PartnersRecruitingCopy = Dictionary['partnersRecruiting']

function MiyagiPartnersRecruitingPage({ source, lang, copy }: {
  source: RecruitingSource
  lang: 'en' | 'es'
  copy: PartnersRecruitingCopy
}) {
  const languageHref = `/us?lang=${lang === 'en' ? 'es' : 'en'}${source === 'direct' ? '' : `&source=${source}`}`
  return (
    <main className="bg-[var(--bg)] text-[var(--fg)]" data-testid="us-partners-recruiting">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <header className="grid gap-10 py-16 sm:py-24 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
          <div>
            <div className="flex items-center justify-between gap-4">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--accent)]">{copy.landing.heroEyebrow}</p>
              <Link href={languageHref} className="text-xs underline">{copy.landing.switchLanguage}</Link>
            </div>
            <h1 className="mt-5 max-w-4xl text-5xl font-semibold leading-[0.98] tracking-[-0.045em] sm:text-7xl">{copy.landing.title}</h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-[var(--fg-muted)]">{copy.landing.body}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <RecruitingTrackLink href="#founding-operator-application" track="founding_operator" source={source} className="btn btn-primary no-underline" testId="operator-primary-cta">{copy.landing.primaryCta}</RecruitingTrackLink>
              <RecruitingTrackLink href="/vende/promotor" track="promoter" source={source} className="btn btn-secondary no-underline" testId="promotor-secondary-cta">{copy.landing.promotorCta}</RecruitingTrackLink>
            </div>
          </div>
          <aside className="border-l-4 border-[var(--agent)] bg-[var(--agent-soft)] p-6">
            <p className="font-mono text-xs uppercase tracking-[0.15em] text-[var(--agent)]">{copy.landing.truthEyebrow}</p>
            <p className="mt-3 leading-7">{copy.landing.truthBody}</p>
          </aside>
        </header>

        <section className="border-y border-[var(--border-strong)] py-12" aria-labelledby="proof-mechanism">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--fg-muted)]">{copy.landing.proofEyebrow}</p>
          <h2 id="proof-mechanism" className="mt-3 text-3xl font-semibold tracking-tight">{copy.landing.proofTitle}</h2>
          <ol className="mt-8 grid gap-px overflow-hidden border border-[var(--border)] bg-[var(--border)] md:grid-cols-4">
            {copy.landing.proofSteps.map(({ number, title, detail }) => <li key={number} className="bg-[var(--bg)] p-5"><span className="font-mono text-sm text-[var(--agent)]">{number}</span><h3 className="mt-5 font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-[var(--fg-muted)]">{detail}</p></li>)}
          </ol>
        </section>

        <section className="grid gap-10 py-14 md:grid-cols-2">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--accent)]">{copy.landing.fitEyebrow}</p>
            <h2 className="mt-3 text-2xl font-semibold">{copy.landing.fitTitle}</h2>
            <ul className="mt-5 space-y-3 text-[var(--fg-muted)]">{copy.landing.fitItems.map((item) => <li key={item}>• {item}</li>)}</ul>
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--promo)]">{copy.landing.notFitEyebrow}</p>
            <h2 className="mt-3 text-2xl font-semibold">{copy.landing.notFitTitle}</h2>
            <ul className="mt-5 space-y-3 text-[var(--fg-muted)]">{copy.landing.notFitItems.map((item) => <li key={item}>• {item}</li>)}</ul>
          </div>
        </section>

        <FoundingOperatorApplication source={source} copy={copy.application} />
      </div>
    </main>
  )
}

function ProofStep({ label, detail }: { label: string; detail: string }) {
  return (
    <div>
      <p className="font-semibold">{label}</p>
      <p className="text-sm text-[var(--color-muted)] leading-5 mt-1">{detail}</p>
    </div>
  )
}
