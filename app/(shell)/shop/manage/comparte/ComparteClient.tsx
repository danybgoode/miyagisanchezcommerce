'use client'

import { useState } from 'react'
import { SellerBreadcrumb } from '../SellerBreadcrumb'
import { Card } from '@/components/ui/Card'
import { Toast, useToast } from '@/components/feedback/Toast'
import ConnectAgentPanel from '@/components/ConnectAgentPanel'
import { buildWhatsAppShareLink } from '@/lib/share-link'
import { pushAnalyticsEvent } from '@/lib/analytics-events'

export default function ComparteClient({
  shopName,
  shopSlug,
  logoUrl,
  location,
  productCount,
  agentTokenSet,
}: {
  shopName: string
  shopSlug: string
  logoUrl: string | null
  location: string | null
  productCount: number
  agentTokenSet: boolean
}) {
  const { toast, showToast, dismissToast } = useToast()
  const [copied, setCopied] = useState(false)

  const shareUrl = `${typeof window !== 'undefined' ? window.location.origin : 'https://miyagisanchez.com'}/s/${shopSlug}`
  const shareTitle = `${shopName} en Miyagi Sánchez`

  function tapShare(channel: string) {
    // first_share_tap — same event + per-shop dedupeKey convention
    // SetupGuideCard's own (now-retired) inline share button used, so a
    // seller who already shared once from the guide card doesn't re-fire it
    // here, and vice versa.
    pushAnalyticsEvent('first_share_tap', { channel }, { dedupeKey: `first_share_tap_${shopSlug}` })
    // Mark the guide's `comparte` step done — the same settings.guide.share_done
    // seam the guide card used to set itself before this page took over the
    // action. Fire-and-forget: a failed write just means the guide step
    // doesn't flip to done yet, nothing else depends on it synchronously.
    fetch('/api/sell/shop', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { guide: { share_done: true } } }),
    }).catch(() => {})
  }

  async function handleCopy() {
    tapShare('copy_link')
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      showToast('Enlace copiado', 'success')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      showToast('No se pudo copiar el enlace', 'error')
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="mb-5">
        <SellerBreadcrumb extra={[{ label: 'Comparte', href: null }]} />
        <h1 className="text-xl font-bold mt-2">Comparte tu tienda</h1>
      </div>

      <Card variant="panel" className="p-5 text-center mb-6">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="w-16 h-16 rounded-[var(--r-pill)] object-cover mx-auto mb-3" />
        ) : (
          <div className="w-16 h-16 rounded-[var(--r-pill)] bg-[var(--color-surface-alt)] flex items-center justify-center mx-auto mb-3 text-xl font-bold">
            {shopName?.[0]?.toUpperCase() ?? 'M'}
          </div>
        )}
        <h2 className="font-bold text-lg">{shopName}</h2>
        <p className="text-sm text-[var(--color-muted)] mt-0.5">
          {productCount} producto{productCount === 1 ? '' : 's'}{location ? ` · ${location}` : ''}
        </p>
        <p className="inline-block mt-2 text-xs font-mono bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-[var(--r-pill)] px-3 py-1">
          /s/{shopSlug}
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 mt-6 pt-5 border-t border-[var(--color-border)]">
          <a
            href={buildWhatsAppShareLink(shareTitle, shareUrl)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => tapShare('whatsapp')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-[var(--r-md)] text-sm font-semibold no-underline hover:opacity-90 transition-opacity"
            style={{ background: 'var(--provider-whatsapp)', color: 'var(--fg-inverse)' }}
          >
            Compartir por WhatsApp
          </a>
          <button type="button" onClick={handleCopy} className="btn btn-secondary">
            {copied ? <><i className="iconoir-check" aria-hidden /> Copiado</> : 'Copiar enlace'}
          </button>
          <a
            href="/api/sell/shop/story-image"
            download="mi-tienda-historia.png"
            onClick={() => tapShare('story_image')}
            className="btn btn-ghost"
          >
            Para tu historia
          </a>
        </div>
      </Card>

      <Card variant="panel" className="p-5">
        <h3 className="font-semibold mb-2">¿Sigues tú o sigue tu agente?</h3>
        <p className="text-sm text-[var(--color-muted)] mb-4">
          Conéctalo… tú apruebas los cambios.
        </p>
        <ConnectAgentPanel initialTokenSet={agentTokenSet} />
      </Card>

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}
