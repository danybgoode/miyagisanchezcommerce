import { currentUser } from '@clerk/nextjs/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { recruitingV3Enabled } from '@/lib/recruiting-v3'
import { inspectFoundingOperatorActivation } from '@/lib/founding-operator-activation'
import { getDictionary, type Locale } from '@/lib/dictionary'

export const dynamic = 'force-dynamic'

function operatorLocale(raw: string | string[] | undefined): Locale {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === 'es' ? 'es' : 'en'
}

export async function generateMetadata({ searchParams }: {
  searchParams: Promise<{ lang?: string | string[] }>
}): Promise<Metadata> {
  const locale = operatorLocale((await searchParams).lang)
  const ui = (await getDictionary(locale)).partnersRecruiting.activation
  return { title: ui.metadataTitle, robots: { index: false } }
}

export default async function FoundingOperatorActivationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ status?: string | string[]; lang?: string | string[] }>
}) {
  if (!(await recruitingV3Enabled())) notFound()
  const { token } = await params
  const state = await inspectFoundingOperatorActivation(token)
  const query = await searchParams
  const rawStatus = query.status
  const status = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus
  const locale = operatorLocale(query.lang)
  const ui = (await getDictionary(locale)).partnersRecruiting.activation
  const activationPath = `/partner/activate/${token}${locale === 'es' ? '?lang=es' : ''}`
  const toggleParams = new URLSearchParams()
  if (locale === 'en') toggleParams.set('lang', 'es')
  if (status) toggleParams.set('status', status)
  const toggleHref = `/partner/activate/${token}${toggleParams.size ? `?${toggleParams}` : ''}`
  if (state === 'ready') {
    const user = await currentUser()
    if (!user) {
      redirect(`/sign-in?redirect_url=${encodeURIComponent(activationPath)}`)
    }
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <div className="flex items-center justify-between gap-4">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--accent)]">{ui.eyebrow}</p>
          <Link href={toggleHref} className="text-xs underline">{ui.switchLanguage}</Link>
        </div>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">{ui.title}</h1>
        <p className="mt-5 leading-7 text-[var(--fg-muted)]">{ui.body}</p>
        {status === 'invalid' && (
          <p role="alert" className="mt-6 border-l-4 border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm">
            {ui.mismatch}
          </p>
        )}
        <form action={`/api/partner/activate/${token}?lang=${locale}`} method="post" className="mt-8">
          <button type="submit" className="btn btn-primary min-h-12 px-6">{ui.cta}</button>
        </form>
        <p className="mt-4 text-xs text-[var(--fg-muted)]">{ui.boundary}</p>
      </main>
    )
  }

  const message = state === 'used'
    ? ui.used
    : state === 'expired'
      ? ui.expired
      : state === 'unavailable'
        ? ui.unavailable
        : ui.invalid
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <div className="flex items-center justify-between gap-4">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--accent)]">Miyagi Partners</p>
        <Link href={toggleHref} className="text-xs underline">{ui.switchLanguage}</Link>
      </div>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">{ui.unavailableTitle}</h1>
      <p className="mt-5 leading-7 text-[var(--fg-muted)]">{message}</p>
    </main>
  )
}
