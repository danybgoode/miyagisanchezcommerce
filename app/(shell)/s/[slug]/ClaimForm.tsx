'use client'

import { BuyerCopyText, useBuyerCopy } from '@/app/components/BuyerPresentationContext'
import { useState } from 'react'

interface Props {
  shopId: string
  shopSlug: string
  shopName: string
}

type State = 'idle' | 'loading' | 'sent' | 'error'

export default function ClaimForm({ shopId, shopSlug, shopName }: Props) {
  const copy = useBuyerCopy()
  const [state, setState] = useState<State>('idle')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [devLink, setDevLink] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setState('loading')
    setErrorMsg('')

    try {
      const res = await fetch('/api/claim/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, shopSlug, shopName, email, message }),
      })

      let data: Record<string, unknown> = {}
      try {
        data = await res.json()
      } catch {
        setErrorMsg('El servidor devolvió una respuesta inesperada. Intenta de nuevo.')
        setState('error')
        return
      }

      if (!res.ok || !data.ok) {
        setErrorMsg((data.error as string) ?? 'Algo salió mal. Intenta de nuevo.')
        setState('error')
        return
      }

      if (typeof data.link === 'string') {
        setDevLink(data.link)
      }
      setState('sent')
    } catch {
      setErrorMsg('Error de red. Intenta de nuevo.')
      setState('error')
    }
  }

  if (state === 'sent') {
    return (
      <div style={{ padding: '20px', background: 'var(--claim-accent-soft)', border: '1px solid var(--claim-accent)', borderRadius: '8px' }}>
        <p style={{ fontWeight: 600, color: 'var(--claim-ink)', marginBottom: '8px' }}>
          <BuyerCopyText copyKey="s.slug.ClaimForm.db24adc4" /></p>
        <p style={{ fontSize: '14px', color: 'var(--claim-muted)', marginBottom: devLink ? '16px' : 0 }}>
          <BuyerCopyText copyKey="s.slug.ClaimForm.8d47ed51" />{' '}<strong>{email}</strong><BuyerCopyText copyKey="s.slug.ClaimForm.14ba9f00" /></p>
        {devLink && (
          <a
            href={devLink}
            style={{
              display: 'inline-block',
              background: 'var(--claim-accent)',
              color: 'var(--fg-inverse)',
              padding: '10px 20px',
              borderRadius: '6px',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: '14px',
            }}
          >
            <BuyerCopyText copyKey="s.slug.ClaimForm.d7366520" /></a>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1"><BuyerCopyText copyKey="s.slug.ClaimForm.43c30262" /></label>
        <input
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-accent)]"
          placeholder={copy('s.slug.ClaimForm.9aa2427a')}
          disabled={state === 'loading'}
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1"><BuyerCopyText copyKey="s.slug.ClaimForm.10e241c5" /></label>
        <textarea
          rows={4}
          value={message}
          onChange={e => setMessage(e.target.value)}
          className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-accent)] resize-none"
          placeholder={copy('s.slug.ClaimForm.d36f280a')}
          disabled={state === 'loading'}
        />
      </div>

      {state === 'error' && (
        <p className="text-sm text-red-600">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={state === 'loading'}
        className="w-full bg-[var(--color-accent)] text-white py-2 rounded font-medium hover:bg-[var(--color-accent-hover)] text-sm disabled:opacity-60"
      >
        {state === 'loading' ? <BuyerCopyText copyKey="s.slug.ClaimForm.3c77c9c9" /> : <BuyerCopyText copyKey="s.slug.ClaimForm.f2f2fc2f" />}
      </button>
    </form>
  )
}
