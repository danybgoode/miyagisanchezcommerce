'use client'

import { useEffect, useRef, useState } from 'react'
import { pushRecruitingEvent, type RecruitingReason, type RecruitingSource, type RecruitingTrack } from '@/lib/recruiting-events'
import type { Dictionary } from '@/lib/dictionary'

type OperatorApplicationCopy = Dictionary['partnersRecruiting']['application']

function isRecruitingTrack(value: string | null): value is RecruitingTrack {
  return value === 'founding_operator' || value === 'promoter'
}

/**
 * The operator application, and the page's funnel instrumentation.
 *
 * It used to be a three-shop evidence dossier with disqualification gates. The US program
 * is the same field-operator program `/vende/promotor` describes, so the form is the same
 * five fields — the qualification conversation happens with a human, after we have read it.
 *
 * This component also owns the page's CTA tracking. The hero and closing CTAs are rendered
 * by the shared (server) landing shell, which cannot carry an onClick; they carry a
 * `data-track` marker instead and one delegated listener here turns a click into the same
 * `track_selected` event the old bespoke links pushed.
 */
export function OperatorApplication({ source = 'direct', copy }: { source?: RecruitingSource; copy: OperatorApplicationCopy }) {
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)
  const errorRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => { pushRecruitingEvent({ event: 'view', track: 'founding_operator', source }) }, [source])
  useEffect(() => { if (error) errorRef.current?.focus() }, [error])

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target.closest('[data-track]') : null
      const track = target?.getAttribute('data-track') ?? null
      if (isRecruitingTrack(track)) pushRecruitingEvent({ event: 'track_selected', track, source })
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [source])

  function markStarted() {
    if (started.current) return
    started.current = true
    pushRecruitingEvent({ event: 'application_started', track: 'founding_operator', source })
  }

  function fail(reason: RecruitingReason, message: string) {
    setError(message)
    pushRecruitingEvent({ event: 'application_disqualified', track: 'founding_operator', source, reason })
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const form = new FormData(event.currentTarget)
    setSubmitting(true)
    try {
      const res = await fetch('/api/promoter/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          program_track: 'founding_operator', operator_details_version: 2,
          name: form.get('name'), email: form.get('email'), whatsapp: form.get('whatsapp'),
          website: form.get('operator_apply_extra_hp'),
          operator_details: { city: form.get('city'), motivation: form.get('motivation') },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        const reason: RecruitingReason = res.status === 429 ? 'rate_limited' : 'unknown'
        fail(reason, reason === 'rate_limited' ? copy.validation.rateLimited : copy.validation.receive)
        return
      }
      // New and idempotent retry results are intentionally indistinguishable so
      // this public surface cannot enumerate applications by email.
      pushRecruitingEvent({ event: 'application_submitted', track: 'founding_operator', source })
      setDone(true)
    } catch {
      setError(copy.validation.network)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) return (
    <div data-testid="operator-apply-success">
      <p className="t-caption" style={{ color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{copy.successEyebrow}</p>
      <h3 className="t-h3" style={{ letterSpacing: 0, margin: 'var(--s-2) 0' }}>{copy.successTitle}</h3>
      <p style={{ color: 'var(--fg-muted)', margin: 0 }}>{copy.successBody}</p>
    </div>
  )

  return (
    <form onSubmit={submit} onFocusCapture={markStarted} data-testid="operator-apply-form" style={{ display: 'grid', gap: 'var(--s-4)', maxWidth: 560 }}>
      <Field label={copy.fields.name} name="name" placeholder={copy.fields.namePlaceholder} autoComplete="name" />
      <Field label={copy.fields.email} name="email" type="email" placeholder={copy.fields.emailPlaceholder} autoComplete="email" />
      <Field label={copy.fields.phone} name="whatsapp" type="tel" placeholder={copy.fields.phonePlaceholder} autoComplete="tel" />
      <Field label={copy.fields.city} name="city" placeholder={copy.fields.cityPlaceholder} autoComplete="address-level2" />
      <label style={{ display: 'grid', gap: 'var(--s-1)', fontSize: 14, fontWeight: 600 }}>
        {copy.fields.motivation}
        <textarea name="motivation" rows={3} maxLength={1000} placeholder={copy.fields.motivationPlaceholder} className="input" />
      </label>
      <label aria-hidden="true" style={{ position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' }}>
        {copy.honeypot}
        <input type="text" name="operator_apply_extra_hp" tabIndex={-1} autoComplete="off" />
      </label>
      {error && (
        <p
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          style={{ margin: 0, borderLeft: '4px solid var(--danger)', background: 'var(--danger-soft)', padding: 'var(--s-3)', fontSize: 14 }}
        >
          {error}
        </p>
      )}
      <button type="submit" disabled={submitting} className="btn btn-primary btn-lg" data-testid="operator-apply-submit" style={{ justifySelf: 'start' }}>
        {submitting ? copy.sending : copy.submit}
      </button>
    </form>
  )
}

function Field({ label, name, ...props }: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label style={{ display: 'grid', gap: 'var(--s-1)', fontSize: 14, fontWeight: 600 }}>
      {label}
      <input required name={name} className="input" {...props} />
    </label>
  )
}
