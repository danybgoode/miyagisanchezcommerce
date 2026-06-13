'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AskSellerButton({
  listingId,
  isSignedIn,
  label = 'Preguntar al vendedor',
  variant = 'button',
}: {
  listingId: string
  isSignedIn: boolean
  label?: string
  /**
   * `'button'` (default) — the full dark CTA, unchanged for every existing caller.
   * `'link'` — a light, centered text link, for the PDP redesign two-action bar
   * (S1.3) where "Preguntar" is demoted below the primary buy / offer actions.
   */
  variant?: 'button' | 'link'
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function askSeller() {
    if (!isSignedIn) {
      router.push(`/sign-in?redirect_url=${encodeURIComponent(`/l/${listingId}`)}`)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/conversations/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, stampKey: 'buyer_price_question' }),
      })
      const data = await res.json() as { conversationId?: string; error?: string }
      if (!res.ok || !data.conversationId) {
        setError(data.error ?? 'No se pudo abrir la conversación.')
        return
      }
      router.push(`/messages/${data.conversationId}`)
    } catch {
      setError('Sin conexión. Inténtalo de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  if (variant === 'link') {
    return (
      <div style={{ textAlign: 'center' }}>
        <button
          type="button"
          onClick={askSeller}
          disabled={loading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            background: 'none',
            border: 'none',
            padding: '4px 8px',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--fg-muted)',
            textDecoration: 'underline',
          }}
        >
          <i className="iconoir-message-text" style={{ fontSize: 14 }} />
          {loading ? 'Abriendo...' : label}
        </button>
        {error && <p style={{ marginTop: 6, fontSize: 12, color: 'var(--danger)' }}>{error}</p>}
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={askSeller}
        disabled={loading}
        className="btn btn-dark btn-lg"
        style={{ width: '100%', justifyContent: 'center' }}
      >
        <i className="iconoir-message-text" style={{ fontSize: 16 }} />
        {loading ? 'Abriendo...' : label}
      </button>
      {error && <p style={{ marginTop: 6, fontSize: 12, color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}
