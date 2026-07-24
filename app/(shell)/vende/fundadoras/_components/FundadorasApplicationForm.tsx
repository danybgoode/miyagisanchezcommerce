'use client'

import { useEffect, useRef, useState } from 'react'
import type es from '@/locales/es.json'

type FormCopy = (typeof es)['sellerAcquisition']['fundadoras']['apply']['form']

/**
 * Tiendas Fundadoras public application form (epic tiendas-fundadoras-acquisition,
 * Stories 2.1–2.3). Plain controlled form + fetch, no library — mirrors
 * PromoterApplicationForm. Three things it does beyond a normal form:
 *
 *  1. SEPARATE consent (Story 2.2): contact consent is a required checkbox;
 *     preview-permission and marketing are separate OPTIONAL checkboxes, each
 *     default UNCHECKED. Leaving one unchecked sends `false`, never nothing that
 *     the server could misread as granted.
 *  2. An OPAQUE subject id (Story 2.3): a random token generated on mount,
 *     never PII, used for the anonymous funnel events and NOT sent as any
 *     identity. The server keys the accepted event on the relationship id
 *     instead — this token only ties the pre-submit funnel steps together.
 *  3. An idempotency key per form instance so a double-tap submit is one write.
 *
 * Funnel events (view / start / validation_failed) POST to the anonymous
 * `/api/growth/fundadoras/track` route, fire-and-forget — a telemetry failure
 * never blocks or surfaces to the applicant. The `accepted` event is emitted
 * server-side only.
 */
export function FundadorasApplicationForm({ copy }: { copy: FormCopy }) {
  const [businessName, setBusinessName] = useState('')
  const [contactName, setContactName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [estado, setEstado] = useState('')
  const [category, setCategory] = useState('')
  const [promoterCode, setPromoterCode] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [contactConsent, setContactConsent] = useState(false)
  const [previewPermission, setPreviewPermission] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Opaque subject id + idempotency key — stable for this form instance, never PII.
  const subjectId = useRef<string>('')
  const idempotencyKey = useRef<string>('')
  const startedRef = useRef(false)
  if (!subjectId.current && typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    subjectId.current = `fnd_${crypto.randomUUID()}`
    idempotencyKey.current = crypto.randomUUID()
  }

  function utmSource(): string | undefined {
    if (typeof window === 'undefined') return undefined
    const v = new URLSearchParams(window.location.search).get('utm_source')
    return v ? v.slice(0, 140) : undefined
  }

  function utmBundle(): Record<string, string> {
    if (typeof window === 'undefined') return {}
    const params = new URLSearchParams(window.location.search)
    const out: Record<string, string> = {}
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'referral']) {
      const v = params.get(key)
      if (v) out[key] = v.slice(0, 140)
    }
    return out
  }

  function track(event: string) {
    if (!subjectId.current) return
    fetch('/api/growth/fundadoras/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, subjectId: subjectId.current, tags: { utm_source: utmSource(), cohort_state: 'open' } }),
      keepalive: true,
    }).catch(() => {}) // fire-and-forget — telemetry never blocks the applicant
  }

  // View event once on mount.
  useEffect(() => {
    track('fundadoras_view')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function markStarted() {
    if (startedRef.current) return
    startedRef.current = true
    track('fundadoras_application_start')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Client-side pre-checks (the server re-validates authoritatively) — fire a
    // PII-free validation_failed funnel event, never the field values.
    if (!phone.trim() && !email.trim()) {
      setError(copy.missingContactError)
      track('fundadoras_validation_failed')
      return
    }
    if (!contactConsent) {
      setError(copy.consentRequiredError)
      track('fundadoras_validation_failed')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/vende/fundadoras/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName,
          contactName,
          phone,
          email,
          estado,
          category,
          promoterCode,
          website,
          contactConsent,
          previewPermission,
          marketing,
          utm: utmBundle(),
          idempotencyKey: idempotencyKey.current,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setError(data?.error ?? copy.genericError)
        return
      }
      setDone(true)
    } catch {
      setError(copy.genericError)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="card-panel" role="status">
        <p>{copy.success}</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} onChange={markStarted} className="card-panel flex flex-col gap-4">
      {/* Honeypot — visually hidden; a real applicant never fills it. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
      />

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{copy.businessNameLabel}</span>
        <input
          className="input"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          placeholder={copy.businessNamePlaceholder}
          maxLength={140}
          required
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{copy.contactNameLabel}</span>
        <input
          className="input"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
          placeholder={copy.contactNamePlaceholder}
          maxLength={140}
          required
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{copy.phoneLabel}</span>
        <input
          className="input"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={copy.phonePlaceholder}
          maxLength={30}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{copy.emailLabel}</span>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={copy.emailPlaceholder}
          maxLength={140}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{copy.estadoLabel}</span>
          <input
            className="input"
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
            placeholder={copy.estadoPlaceholder}
            maxLength={100}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{copy.categoryLabel}</span>
          <input
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder={copy.categoryPlaceholder}
            maxLength={100}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{copy.promoterCodeLabel}</span>
        <input
          className="input"
          value={promoterCode}
          onChange={(e) => setPromoterCode(e.target.value)}
          placeholder={copy.promoterCodePlaceholder}
          maxLength={20}
        />
      </label>

      {/* Separate, explicit consent choices (Story 2.2). */}
      <fieldset className="flex flex-col gap-3 border-t pt-4">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={contactConsent}
            onChange={(e) => setContactConsent(e.target.checked)}
            required
          />
          <span className="text-sm">{copy.contactConsentLabel}</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={previewPermission} onChange={(e) => setPreviewPermission(e.target.checked)} />
          <span className="text-sm">{copy.previewConsentLabel}</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
          <span className="text-sm">{copy.marketingConsentLabel}</span>
        </label>
      </fieldset>

      {error && (
        <p className="t-small" role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary btn-lg" disabled={submitting}>
        {submitting ? copy.submitting : copy.submit}
      </button>
    </form>
  )
}
