'use client'

import { BuyerCopyText, useBuyerCopy } from '@/app/components/BuyerPresentationContext'
/**
 * Public writer-submission portal (bookshop-launchpad S1.1). No account — the
 * email code IS the identity check (sweepstakes spine). Flow: fill form + pick
 * file → "Enviar código" (POST /verification) → enter code → "Enviar manuscrito"
 * uploads the file (POST /upload → private bucket) then persists (POST /submit).
 * es-MX only (not on the bilingual allow-list). White-label chrome comes from
 * the (shell) ChannelLayout on own-domain/subdomain channels.
 */

import { useState } from 'react'

const ERRORS: Record<string, string> = {
  invalid_email: 'Escribe un correo válido.',
  invalid_title: 'Escribe el título de tu obra.',
  invalid_author: 'Escribe tu nombre.',
  missing_code: 'Escribe el código que te enviamos.',
  invalid_code: 'El código no es válido o venció. Pide uno nuevo.',
  missing_manuscript: 'Falta tu manuscrito.',
  invalid_manuscript: 'No pudimos validar tu archivo. Vuelve a subirlo.',
  missing_fields: 'Completa los campos requeridos.',
  not_accepting: 'Esta tienda no está recibiendo manuscritos en este momento.',
  not_found: 'No encontramos esta convocatoria.',
  launchpad_disabled: 'La convocatoria no está disponible.',
  rate_limited: 'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
  unavailable: 'Algo salió mal. Inténtalo de nuevo.',
}

const ACCEPT = '.pdf,.epub,.docx,application/pdf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export default function ConvocatoriaClient({
  slug,
  shopName,
  guidelines,
  maxSizeMb,
}: {
  slug: string
  shopName: string
  guidelines: string | null
  maxSizeMb: number
}) {
  const copy = useBuyerCopy()
  const [title, setTitle] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [email, setEmail] = useState('')
  const [synopsis, setSynopsis] = useState('')
  const [genre, setGenre] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [code, setCode] = useState('')
  const [agreed, setAgreed] = useState(false)

  const [codeSent, setCodeSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const base = `/api/launchpad/${encodeURIComponent(slug)}`

  function showError(code: string) {
    setError(ERRORS[code] ?? ERRORS.unavailable)
  }

  async function sendCode() {
    setError(null)
    if (!email.trim()) { showError('invalid_email'); return }
    setSending(true)
    try {
      const res = await fetch(`${base}/verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { showError(data.error ?? 'unavailable'); return }
      setCodeSent(true)
    } catch {
      showError('unavailable')
    } finally {
      setSending(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!title.trim()) { showError('invalid_title'); return }
    if (!authorName.trim()) { showError('invalid_author'); return }
    if (!email.trim()) { showError('invalid_email'); return }
    if (!file) { showError('missing_manuscript'); return }
    if (!agreed) { setError('Acepta los términos para enviar tu obra.'); return }
    if (!code.trim()) { showError('missing_code'); return }

    setSubmitting(true)
    try {
      // 1) Upload the manuscript to the private bucket.
      const fd = new FormData()
      fd.append('file', file)
      const up = await fetch(`${base}/upload`, { method: 'POST', body: fd })
      const upData = await up.json().catch(() => ({})) as { key?: string; format?: string; name?: string; size?: number; error?: string }
      if (!up.ok || !upData.key) {
        setError(upData.error ?? ERRORS.unavailable)
        return
      }

      // 2) Verify the code + persist the submission.
      const res = await fetch(`${base}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, authorName, email, synopsis, genre, code,
          manuscript: { key: upData.key, format: upData.format, name: upData.name, size: upData.size },
        }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; submission_id?: string }
      if (!res.ok) { showError(data.error ?? 'unavailable'); return }
      setDone(true)
    } catch {
      showError('unavailable')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="border border-[var(--color-border)] rounded-xl p-6 text-center">
        <div className="text-4xl mb-3"><i className="iconoir-book" aria-hidden /></div>
        <h2 className="text-2xl font-bold"><BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.bcffad2e" /></h2>
        <p className="mt-3 text-[var(--color-muted)] leading-7">
          {shopName} <BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.f80e01f3" />{' '}<strong>«{title.trim()}»</strong><BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.82737e99" />{' '}
          <strong>{email.trim()}</strong> <BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.7632d4f3" /></p>
      </div>
    )
  }

  const fileTooBig = !!file && file.size > maxSizeMb * 1024 * 1024

  return (
    <form onSubmit={submit} className="border border-[var(--color-border)] rounded-xl p-5 sm:p-6">
      <h2 className="text-2xl font-bold"><BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.8b70030b" /></h2>
      <p className="mt-2 text-sm text-[var(--color-muted)] leading-6">
        <BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.b4e5a39b" /></p>

      <div className="mt-5 space-y-4">
        <label className="block text-sm font-medium">
          <BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.05c8558c" /><input value={title} onChange={e => setTitle(e.target.value)} maxLength={200}
            className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)]" />
        </label>

        <label className="block text-sm font-medium">
          <BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.ba4f7fab" /><input value={authorName} onChange={e => setAuthorName(e.target.value)} maxLength={120}
            className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)]" />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block text-sm font-medium">
            <BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.5691e360" /><input value={genre} onChange={e => setGenre(e.target.value)} maxLength={60} placeholder={copy('s.slug.convocatoria.ConvocatoriaClient.cf40fd4c')}
              className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)]" />
          </label>
        </div>

        <label className="block text-sm font-medium">
          <BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.6ae84ee8" /><textarea value={synopsis} onChange={e => setSynopsis(e.target.value)} rows={4} maxLength={2000}
            placeholder={copy('s.slug.convocatoria.ConvocatoriaClient.1b6a87b8')}
            className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)] leading-relaxed" />
        </label>

        <label className="block text-sm font-medium">
          <BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.b2dba380" />{' '}{maxSizeMb} <BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.fb43f467" /><input type="file" accept={ACCEPT} onChange={e => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 w-full text-sm file:mr-3 file:rounded-lg file:border file:border-[var(--color-border)] file:bg-[var(--color-surface-alt)] file:px-3 file:py-2 file:text-sm" />
        </label>
        {file && !fileTooBig && (
          <p className="text-xs text-[var(--color-muted)]">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} <BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.d95ea8d6" /></p>
        )}
        {fileTooBig && (
          <p className="text-xs text-red-600"><BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.cb1b2ae0" />{' '}{maxSizeMb} <BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.32b609eb" /></p>
        )}

        <label className="block text-sm font-medium">
          <BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.a033d5f9" /><div className="mt-1 flex gap-2">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              className="min-w-0 flex-1 border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)]" />
            <button type="button" onClick={sendCode} disabled={sending}
              className="shrink-0 px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm font-semibold disabled:opacity-50">
              {sending ? <BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.4b69ae82" /> : codeSent ? <BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.d9ba1536" /> : <BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.cba247f1" />}
            </button>
          </div>
        </label>
        {codeSent && <p className="text-sm text-green-700"><BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.b1f5b90f" />{' '}{email.trim()}<BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.7e893aca" /></p>}

        <label className="block text-sm font-medium">
          <BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.d80e309d" /><input value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={6}
            className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)] font-mono tracking-widest" />
        </label>

        <label className="flex items-start gap-2 text-xs text-[var(--color-muted)] leading-5">
          <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5" />
          <span>
            <BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.0531285c" /></span>
        </label>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button disabled={submitting || fileTooBig}
        className="mt-5 w-full bg-[var(--color-accent)] text-white rounded-lg px-4 py-3 text-sm font-semibold disabled:opacity-50">
        {submitting ? <BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.4b69ae82" /> : <BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.5af63f84" />}
      </button>

      {guidelines && (
        <div className="mt-6 border-t border-[var(--color-border)] pt-5">
          <h3 className="font-semibold text-sm mb-2"><BuyerCopyText copyKey="s.slug.convocatoria.ConvocatoriaClient.5c6369f5" />{' '}{shopName}</h3>
          <p className="text-xs leading-5 text-[var(--color-muted)] whitespace-pre-line">{guidelines}</p>
        </div>
      )}
    </form>
  )
}
