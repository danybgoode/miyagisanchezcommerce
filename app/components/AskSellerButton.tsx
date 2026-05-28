'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AskSellerButton({
  listingId,
  isSignedIn,
  label = 'Preguntar al vendedor',
}: {
  listingId: string
  isSignedIn: boolean
  label?: string
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
