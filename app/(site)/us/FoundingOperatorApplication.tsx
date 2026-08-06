'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { canonicalCandidateShopUrl } from '@/lib/candidate-shop-url'
import { pushRecruitingEvent, type RecruitingReason, type RecruitingSource } from '@/lib/recruiting-events'
import type { CandidateChannel, CandidatePlatform, MerchantAwareness } from '@/lib/promoter-applications'

type ShopDraft = { url: string; platform: CandidatePlatform; channels: CandidateChannel[]; merchant_awareness: MerchantAwareness }
const EMPTY_SHOP = (): ShopDraft => ({ url: '', platform: 'shopify', channels: ['online_store'], merchant_awareness: 'not_contacted' })
const CHANNEL_OPTIONS: Array<[CandidateChannel, string]> = [
  ['online_store', 'Owned online store'], ['marketplace', 'Marketplace'], ['social', 'Social commerce'], ['wholesale', 'Wholesale'], ['other', 'Other'],
]
const AWARENESS_OPTIONS: Array<[MerchantAwareness, string]> = [
  ['not_contacted', 'Not contacted about this nomination'],
  ['aware_of_nomination', 'Aware that I am nominating the shop'],
  ['interested_in_conversation', 'Interested in a conversation with Miyagi'],
]

export function RecruitingTrackLink({ href, track, source = 'direct', children, className, testId }: {
  href: string; track: 'founding_operator' | 'promoter'; source?: RecruitingSource; children: React.ReactNode; className?: string; testId?: string
}) {
  return <Link href={href} className={className} data-testid={testId} onClick={() => pushRecruitingEvent({ event: 'track_selected', track, source })}>{children}</Link>
}

export function FoundingOperatorApplication({ source = 'direct' }: { source?: RecruitingSource }) {
  const [shops, setShops] = useState<[ShopDraft, ShopDraft, ShopDraft]>([EMPTY_SHOP(), EMPTY_SHOP(), EMPTY_SHOP()])
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)
  const errorRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => { pushRecruitingEvent({ event: 'view', track: 'founding_operator', source }) }, [source])
  useEffect(() => { if (error) errorRef.current?.focus() }, [error])

  function markStarted() {
    if (started.current) return
    started.current = true
    pushRecruitingEvent({ event: 'application_started', track: 'founding_operator', source })
  }

  function updateShop(index: number, patch: Partial<ShopDraft>) {
    setShops((current) => current.map((shop, i) => i === index ? { ...shop, ...patch } : shop) as [ShopDraft, ShopDraft, ShopDraft])
  }

  function toggleChannel(index: number, channel: CandidateChannel) {
    const current = shops[index].channels
    updateShop(index, { channels: current.includes(channel) ? current.filter((value) => value !== channel) : [...current, channel] })
  }

  function disqualify(reason: RecruitingReason, message: string) {
    setError(message)
    pushRecruitingEvent({ event: 'application_disqualified', track: 'founding_operator', source, reason })
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const form = new FormData(event.currentTarget)
    const activeShopCount = Number(form.get('active_shop_count'))
    if (!Number.isInteger(activeShopCount) || activeShopCount < 3) {
      disqualify('shop_count', 'This proof requires an operator who actively supports at least three shops.')
      return
    }
    const normalizedShops = shops.map((shop) => ({ ...shop, url: canonicalCandidateShopUrl(shop.url) }))
    if (normalizedShops.some((shop) => !shop.url)) {
      disqualify('shop_url', 'Each ledger entry needs a public http or https shop URL. Local, private, or credential-bearing URLs are not accepted.')
      return
    }
    if (shops.some((shop) => shop.channels.length === 0)) {
      disqualify('qualification', 'Choose at least one operating channel for every shop.')
      return
    }
    if (form.get('checkpoint_90_day') !== 'yes') {
      disqualify('qualification', 'Confirm that you can participate in a 90-day operating checkpoint.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/promoter/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          program_track: 'founding_operator', operator_details_version: 1,
          name: form.get('name'), email: form.get('email'), whatsapp: form.get('whatsapp'),
          website: form.get('operator_apply_extra_hp'),
          operator_details: {
            company_name: form.get('company_name'), operator_role: form.get('operator_role'), active_shop_count: activeShopCount,
            candidate_shops: normalizedShops, recent_operating_problem: form.get('recent_operating_problem'),
            must_retain_systems: form.get('must_retain_systems'), why_now: form.get('why_now'), checkpoint_90_day: true,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        const reason: RecruitingReason = res.status === 429 ? 'rate_limited' : (data.reason === 'shop_count' || data.reason === 'shop_url' || data.reason === 'qualification' ? data.reason : 'unknown')
        disqualify(reason, data.error ?? 'We could not receive the application. Try again.')
        return
      }
      if (data.duplicate) pushRecruitingEvent({ event: 'application_disqualified', track: 'founding_operator', source, reason: 'duplicate' })
      else pushRecruitingEvent({ event: 'application_submitted', track: 'founding_operator', source })
      setDone(true)
    } catch {
      setError('We could not receive the application. Your answers are still here; try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) return (
    <section id="founding-operator-application" className="border-t border-[var(--border)] py-14" data-testid="operator-apply-success">
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--accent)]">Dossier received</p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight">Received for review — not accepted yet.</h2>
      <p className="mt-4 max-w-2xl text-[var(--fg-muted)] leading-7">We will review the operating fit and contact you directly. This submission created no shop access, contacted no merchant, and granted no permission.</p>
    </section>
  )

  return (
    <section id="founding-operator-application" className="border-t border-[var(--border)] py-14" aria-labelledby="operator-application-title">
      <div className="max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--accent)]">Application dossier · version 1</p>
        <h2 id="operator-application-title" className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight">Put three real shops on the table.</h2>
        <p className="mt-4 text-[var(--fg-muted)] leading-7">We ask for public evidence and operating constraints—not passwords, tokens, customer data, revenue, or a cutover commitment.</p>
      </div>

      <form onSubmit={submit} onFocusCapture={markStarted} className="mt-10 max-w-4xl space-y-10" data-testid="operator-apply-form">
        <fieldset className="grid gap-5 sm:grid-cols-2">
          <legend className="sr-only">Your operating profile</legend>
          <Field label="Your name" name="name" autoComplete="name" />
          <Field label="Work email" name="email" type="email" autoComplete="email" />
          <Field label="WhatsApp or phone" name="whatsapp" type="tel" autoComplete="tel" />
          <Field label="Company or practice" name="company_name" autoComplete="organization" />
          <Field label="Your operating role" name="operator_role" placeholder="e.g. agency principal, ecommerce lead" />
          <Field label="Active shops you operate today" name="active_shop_count" type="number" min="3" max="10000" inputMode="numeric" />
        </fieldset>

        <fieldset>
          <legend className="text-xl font-semibold">Three-shop evidence ledger</legend>
          <p className="mt-2 text-sm text-[var(--fg-muted)]">A nomination is not merchant consent. Miyagi will not contact these shops from this form.</p>
          <ol className="mt-5 border-y border-[var(--border-strong)] divide-y divide-[var(--border)]">
            {shops.map((shop, index) => (
              <li key={index} className="grid gap-5 py-7 md:grid-cols-[3rem_1fr]">
                <div className="font-mono text-sm text-[var(--agent)]" aria-hidden="true">0{index + 1}</div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <label className="sm:col-span-2 grid gap-1.5 text-sm font-medium">
                    Public shop URL
                    <input required type="url" inputMode="url" value={shop.url} onChange={(e) => updateShop(index, { url: e.target.value })} placeholder="https://shop.example" className="input" data-testid={`operator-shop-url-${index + 1}`} />
                  </label>
                  <label className="grid gap-1.5 text-sm font-medium">Platform
                    <select value={shop.platform} onChange={(e) => updateShop(index, { platform: e.target.value as CandidatePlatform })} className="input">
                      <option value="shopify">Shopify</option><option value="woocommerce">WooCommerce</option><option value="other">Other</option>
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-sm font-medium">Merchant awareness
                    <select value={shop.merchant_awareness} onChange={(e) => updateShop(index, { merchant_awareness: e.target.value as MerchantAwareness })} className="input">
                      {AWARENESS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <fieldset className="sm:col-span-2">
                    <legend className="text-sm font-medium">Channels you operate for this shop</legend>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                      {CHANNEL_OPTIONS.map(([value, label]) => <label key={value} className="flex items-center gap-2 text-sm text-[var(--fg-muted)]"><input type="checkbox" checked={shop.channels.includes(value)} onChange={() => toggleChannel(index, value)} /> {label}</label>)}
                    </div>
                  </fieldset>
                </div>
              </li>
            ))}
          </ol>
        </fieldset>

        <fieldset className="grid gap-5">
          <legend className="text-xl font-semibold">Operating constraints</legend>
          <TextArea label="One recent operating problem across these shops" name="recent_operating_problem" />
          <TextArea label="Systems or merchant practices that must remain in place" name="must_retain_systems" />
          <TextArea label="Why is a 90-day parallel proof worth testing now?" name="why_now" />
          <label className="flex items-start gap-3 border-l-4 border-[var(--promo)] bg-[var(--promo-soft)] px-4 py-3 text-sm leading-6">
            <input required type="checkbox" name="checkpoint_90_day" value="yes" className="mt-1" />
            <span>I can join a 90-day working checkpoint. I understand this is a no-cutover proof, not acceptance, shop access, merchant consent, permanent free pricing, or revenue share.</span>
          </label>
        </fieldset>

        <label className="absolute left-[-9999px] h-px w-px overflow-hidden" aria-hidden="true">Additional field<input type="text" name="operator_apply_extra_hp" tabIndex={-1} autoComplete="off" /></label>
        {error && <p ref={errorRef} tabIndex={-1} role="alert" className="border-l-4 border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm">{error}</p>}
        <button type="submit" disabled={submitting} className="btn btn-primary min-h-12 px-6" data-testid="operator-apply-submit">{submitting ? 'Sending dossier…' : 'Submit for founder review'}</button>
        <p className="text-xs text-[var(--fg-muted)]">Success means received for review. It does not create an account, grant a shop, or contact a nominated merchant.</p>
      </form>
    </section>
  )
}

function Field({ label, name, ...props }: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <label className="grid gap-1.5 text-sm font-medium">{label}<input required name={name} className="input" {...props} /></label>
}
function TextArea({ label, name }: { label: string; name: string }) {
  return <label className="grid gap-1.5 text-sm font-medium">{label}<textarea required name={name} rows={4} maxLength={1200} className="input" /></label>
}
