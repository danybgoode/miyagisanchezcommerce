'use client'

import { useState } from 'react'

type FormCopy = {
  nameLabel: string
  namePlaceholder: string
  emailLabel: string
  emailPlaceholder: string
  whatsappLabel: string
  whatsappPlaceholder: string
  cityLabel: string
  cityPlaceholder: string
  motivationLabel: string
  motivationPlaceholder: string
  submit: string
  submitting: string
  success: string
  genericError: string
}

/**
 * Self-serve promoter application form (epic 08 · promoter-funnel-v2 · S2 · US-2.1).
 * Mounted at the `#promotor-aplica` anchor in place of the interim teaser. Plain
 * controlled form + fetch, no library — mirrors PromoterCloseClient's BindStep.
 * Includes a visually-hidden honeypot field (`website`) a real applicant never sees.
 */
export function PromoterApplicationForm({ copy }: { copy: FormCopy }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [city, setCity] = useState('')
  const [motivation, setMotivation] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/promoter/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, whatsapp, city, motivation, website }),
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
      <p className="t-lead" style={{ color: 'var(--fg)' }} data-testid="promoter-apply-success">
        {copy.success}
      </p>
    )
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--s-4)', maxWidth: 480 }} data-testid="promoter-apply-form">
      <label style={{ display: 'grid', gap: 'var(--s-1)' }}>
        <span className="t-small" style={{ color: 'var(--fg-muted)' }}>{copy.nameLabel}</span>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={copy.namePlaceholder}
          className="input"
        />
      </label>
      <label style={{ display: 'grid', gap: 'var(--s-1)' }}>
        <span className="t-small" style={{ color: 'var(--fg-muted)' }}>{copy.emailLabel}</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={copy.emailPlaceholder}
          className="input"
        />
      </label>
      <label style={{ display: 'grid', gap: 'var(--s-1)' }}>
        <span className="t-small" style={{ color: 'var(--fg-muted)' }}>{copy.whatsappLabel}</span>
        <input
          type="tel"
          required
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          placeholder={copy.whatsappPlaceholder}
          className="input"
        />
      </label>
      <label style={{ display: 'grid', gap: 'var(--s-1)' }}>
        <span className="t-small" style={{ color: 'var(--fg-muted)' }}>{copy.cityLabel}</span>
        <input
          type="text"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder={copy.cityPlaceholder}
          className="input"
        />
      </label>
      <label style={{ display: 'grid', gap: 'var(--s-1)' }}>
        <span className="t-small" style={{ color: 'var(--fg-muted)' }}>{copy.motivationLabel}</span>
        <textarea
          value={motivation}
          onChange={(e) => setMotivation(e.target.value)}
          placeholder={copy.motivationPlaceholder}
          rows={3}
          className="input"
        />
      </label>

      {/* Honeypot — visually hidden off-screen, never `display:none`, so a scripted
          bot that fills every visible-in-DOM input still trips it; a real person never
          sees or reaches it. */}
      <label style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }} aria-hidden="true">
        Website
        <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </label>

      {error ? <p className="t-small" style={{ color: 'var(--danger)' }}>{error}</p> : null}

      <button type="submit" className="btn btn-primary" disabled={submitting} data-testid="promoter-apply-submit">
        {submitting ? copy.submitting : copy.submit}
      </button>
    </form>
  )
}
