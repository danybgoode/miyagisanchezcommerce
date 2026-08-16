import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { recruitingV3Enabled } from '@/lib/recruiting-v3'
import { FoundingOperatorApplication, RecruitingTrackLink } from './FoundingOperatorApplication'
import { coarseRecruitingSource } from '@/lib/recruiting-source'
import type { RecruitingSource } from '@/lib/recruiting-events'
import { getDictionary, type Dictionary } from '@/lib/dictionary'

/**
 * Founding-operator recruiting lives at `/us/operators`, NOT at `/us`.
 *
 * It used to be a flag gate on `/us` itself, sharing that URL with a legacy
 * "private pilot" page. The US marketplace epic opened `/us` as a real
 * marketplace home and that legacy page became false — the marketplace IS open.
 * Recruiting is a separate product with a separate audience, so it moved to its
 * own route rather than contending for the market root: flipping the recruiting
 * flag must never close the marketplace.
 *
 * While the flag is off this route 404s. That is the honest answer for a program
 * that has not opened — never a placeholder implying the marketplace is closed.
 */
export const metadata: Metadata = {
  title: 'Miyagi Sánchez — Founding operator program',
  description:
    'Miyagi Sánchez is recruiting owner-led operators who steward several independent-product shops as one operating practice.',
  robots: { index: false, follow: false },
}

// The production authority is runtime Golden Beans; never freeze the OFF default
// into a static build artifact or a later cohort flip would have no effect.
export const dynamic = 'force-dynamic'

export default async function UnitedStatesOperatorsPage({ searchParams }: { searchParams: Promise<{ source?: string | string[]; lang?: string | string[] }> }) {
  const query = await searchParams
  const source = coarseRecruitingSource(query.source)
  const locale: 'en' | 'es' = query.lang === 'es' ? 'es' : 'en'
  if (!(await recruitingV3Enabled())) notFound()
  const copy = (await getDictionary(locale)).partnersRecruiting
  return <MiyagiPartnersRecruitingPage source={source} lang={locale} copy={copy} />
}

type PartnersRecruitingCopy = Dictionary['partnersRecruiting']

function MiyagiPartnersRecruitingPage({ source, lang, copy }: {
  source: RecruitingSource
  lang: 'en' | 'es'
  copy: PartnersRecruitingCopy
}) {
  const languageHref = `/us/operators?lang=${lang === 'en' ? 'es' : 'en'}${source === 'direct' ? '' : `&source=${source}`}`
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
