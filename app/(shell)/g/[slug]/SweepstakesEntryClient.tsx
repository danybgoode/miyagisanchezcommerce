'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { Dictionary, Locale } from '@/lib/dictionary'

type PublicUi = Dictionary['sweepstakes']['public']
type Status = 'active' | 'not_live' | 'ended'

export default function SweepstakesEntryClient({
  slug,
  locale,
  ui,
  title,
  description,
  terms,
  prizeImageUrl,
  endsAt,
  publicUrl,
  languageHref,
  status,
  purchaseBonusEnabled,
  purchaseTicketValue,
  shopUrl,
  shopName,
}: {
  slug: string
  locale: Locale
  ui: PublicUi
  title: string
  description: string
  terms: string
  prizeImageUrl: string | null
  endsAt: string | null
  publicUrl: string
  languageHref: string
  status: Status
  purchaseBonusEnabled: boolean
  purchaseTicketValue: number
  shopUrl: string | null
  shopName: string | null
}) {
  const [now, setNow] = useState(() => Date.now())
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ticketCount, setTicketCount] = useState<number | null>(null)

  // Tick the countdown once a second, but only while the tab is visible — a hidden/
  // backgrounded tab needn't re-render. Resync the clock immediately on return.
  useEffect(() => {
    let timer: number | undefined

    function start() {
      if (timer === undefined) timer = window.setInterval(() => setNow(Date.now()), 1000)
    }
    function stop() {
      if (timer !== undefined) { window.clearInterval(timer); timer = undefined }
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') { setNow(Date.now()); start() }
      else stop()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [])

  const target = endsAt ? new Date(endsAt).getTime() : now
  const diff = Math.max(0, target - now)
  const countdown = useMemo(() => {
    const totalSeconds = Math.floor(diff / 1000)
    const days = Math.floor(totalSeconds / 86400)
    const hours = Math.floor((totalSeconds % 86400) / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return { days, hours, minutes, seconds }
  }, [diff])

  const disabled = status !== 'active'
  const errorText = error ? ui.errors[error as keyof typeof ui.errors] ?? ui.errors.unavailable : null
  const shareText = `${title} ${publicUrl}`

  async function sendCode() {
    setError(null)
    if (!email.trim()) { setError('invalid_email'); return }
    setSending(true)
    try {
      const res = await fetch(`/api/sweepstakes/${encodeURIComponent(slug)}/verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, locale }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) { setError(data.error ?? 'unavailable'); return }
      setCodeSent(true)
    } catch {
      setError('unavailable')
    } finally {
      setSending(false)
    }
  }

  async function submitEntry(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim() || !email.trim() || !code.trim()) { setError('missing_fields'); return }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/sweepstakes/${encodeURIComponent(slug)}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, code, locale }),
      })
      const data = await res.json() as { error?: string; ticket_count?: number }
      if (!res.ok) { setError(data.error ?? 'unavailable'); return }
      setTicketCount(data.ticket_count ?? 0)
    } catch {
      setError('unavailable')
    } finally {
      setSubmitting(false)
    }
  }

  async function shareNative() {
    try {
      if (navigator.share) {
        await navigator.share({ title, text: shareText, url: publicUrl })
      } else {
        await navigator.clipboard.writeText(publicUrl)
      }
    } catch {
      // Sharing is optional; ignore cancellation.
    }
  }

  return (
    <main className="min-h-screen bg-[var(--color-background)]">
      <div className="max-w-5xl mx-auto px-4 py-6 sm:py-10">
        <div className="flex items-center justify-between gap-4 mb-6">
          <Link href="/" className="font-semibold no-underline text-sm">miyagisanchez.com</Link>
          <Link href={languageHref} className="text-sm border border-[var(--color-border)] rounded-lg px-3 py-2 no-underline hover:bg-[var(--color-surface-alt)]">
            {ui.language}
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-8 items-start">
          <section>
            <div className="aspect-[4/3] rounded-xl overflow-hidden bg-[var(--color-surface-alt)] border border-[var(--color-border)]">
              {prizeImageUrl ? (
                <img src={prizeImageUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-sm text-[var(--color-muted)]">
                  {title}
                </div>
              )}
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold mt-5 leading-tight">{title}</h1>
            <p className="text-base text-[var(--color-muted)] leading-7 mt-3">{description}</p>

            <div className="mt-6 border border-[var(--color-border)] rounded-xl p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--color-muted)] font-semibold mb-3">{ui.countdown}</p>
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  [countdown.days, ui.days],
                  [countdown.hours, ui.hours],
                  [countdown.minutes, ui.minutes],
                  [countdown.seconds, ui.seconds],
                ].map(([value, label]) => (
                  <div key={label} className="rounded-lg bg-[var(--color-surface-alt)] px-2 py-3">
                    <div className="text-2xl font-bold tabular-nums">{String(value).padStart(2, '0')}</div>
                    <div className="text-xs text-[var(--color-muted)]">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="border border-[var(--color-border)] rounded-xl p-5 sm:p-6">
            {ticketCount != null ? (
              <div>
                <h2 className="text-2xl font-bold">{ui.successTitle}</h2>
                <div className="mt-4 rounded-lg bg-green-50 border border-green-200 p-4">
                  <div className="text-sm text-green-700">{ui.ticketCount}</div>
                  <div className="text-4xl font-bold text-green-700 mt-1">{ticketCount}</div>
                </div>

                {purchaseBonusEnabled && shopUrl && (
                  <div className="mt-5 border border-[var(--color-border)] rounded-lg p-4">
                    <p className="text-sm text-[var(--color-muted)]">
                      {ui.purchaseUpsell} (+{purchaseTicketValue})
                    </p>
                    <Link href={shopUrl} className="inline-block mt-3 bg-[var(--color-accent)] text-white px-4 py-2 rounded-lg text-sm font-semibold no-underline">
                      {ui.shopCta}{shopName ? ` · ${shopName}` : ''}
                    </Link>
                  </div>
                )}

                <div className="mt-5 flex flex-wrap gap-2">
                  <a className="px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm no-underline" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">{ui.whatsapp}</a>
                  <button className="px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm" onClick={shareNative}>{ui.instagram}</button>
                  <a className="px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm no-underline" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">{ui.x}</a>
                </div>
              </div>
            ) : (
              <form onSubmit={submitEntry}>
                <h2 className="text-2xl font-bold">{ui.enterTitle}</h2>

                {status !== 'active' && (
                  <p className="mt-3 text-sm rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
                    {status === 'ended' ? ui.ended : ui.notLive}
                  </p>
                )}

                <div className="mt-5 space-y-4">
                  <label className="block text-sm font-medium">
                    {ui.name}
                    <input value={name} onChange={(e) => setName(e.target.value)} disabled={disabled} className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)]" />
                  </label>
                  <label className="block text-sm font-medium">
                    {ui.email}
                    <div className="mt-1 flex gap-2">
                      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={disabled} className="min-w-0 flex-1 border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)]" />
                      <button type="button" onClick={sendCode} disabled={disabled || sending} className="shrink-0 px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm font-semibold disabled:opacity-50">
                        {sending ? ui.sendingCode : ui.sendCode}
                      </button>
                    </div>
                  </label>
                  {codeSent && <p className="text-sm text-green-700">{ui.codeSent}</p>}
                  <label className="block text-sm font-medium">
                    {ui.code}
                    <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} disabled={disabled} className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)] font-mono tracking-wide" />
                  </label>
                </div>

                {errorText && <p className="mt-3 text-sm text-red-600">{errorText}</p>}

                <button disabled={disabled || submitting} className="mt-5 w-full bg-[var(--color-accent)] text-white rounded-lg px-4 py-3 text-sm font-semibold disabled:opacity-50">
                  {submitting ? ui.submitting : ui.submit}
                </button>
              </form>
            )}

            <div className="mt-6 border-t border-[var(--color-border)] pt-5">
              <h3 className="font-semibold text-sm mb-2">{ui.terms}</h3>
              <p className="text-xs leading-5 text-[var(--color-muted)] whitespace-pre-line">{terms}</p>
              <p className="text-xs text-[var(--color-muted)] mt-3">
                {ui.tosPrefix}{' '}
                <Link href={`/terminos?lang=${locale}`} className="underline">{ui.tosLink}</Link>
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
