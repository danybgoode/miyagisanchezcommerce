'use client'

/**
 * Living Shop — the responsive preview (epic 07, Story 5.5).
 *
 * It renders the LIVE PUBLIC SHOP in an iframe with the pending configuration
 * passed as query parameters, so there is exactly ONE visual implementation.
 * A second renderer that "looks like" the shop is the thing this story forbids
 * by name — and it is also how a preview starts lying: the two drift, the
 * merchant trusts the wrong one, and the bug is invisible until a buyer sees it.
 *
 * UNSAVED STATE NEVER LEAKS. The pending section order travels in the URL of
 * THIS request only; the public shop reads its persisted settings for everybody
 * else. The preview parameters are honoured only for a request that already
 * proved it owns the shop — see `lib/shop-presentation/preview.ts`.
 *
 * The iframe is isolated on purpose: a render error inside the preview shows as
 * a broken frame, not as a lost editing session.
 */

import { useState } from 'react'
import type { SectionConfig } from '@/lib/shop-presentation/types'
import type { StudioShop } from './types'

const VIEWPORTS = [
  { key: 'mobile', label: 'Celular', width: 390 },
  { key: 'desktop', label: 'Escritorio', width: 1100 },
] as const

export default function PreviewTab({
  shop,
  sections,
}: {
  shop: StudioShop
  sections: SectionConfig
}) {
  const [viewport, setViewport] = useState<'mobile' | 'desktop'>('mobile')
  const active = VIEWPORTS.find((v) => v.key === viewport)!

  // Only the SECTION draft travels. The shop's look is a saved preset, so the
  // preview shows it exactly as a visitor would — there is no unsaved look to
  // overlay, and nothing here that could disagree with Diseño y marca.
  const params = new URLSearchParams({
    preview: '1',
    sections: JSON.stringify(sections),
  })
  const src = `/mx/s/${shop.slug}?${params.toString()}`

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div role="group" aria-label="Tamaño de pantalla" className="flex gap-1">
          {VIEWPORTS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setViewport(v.key)}
              aria-pressed={viewport === v.key}
              className={`text-sm px-3 py-1.5 rounded-lg border ${
                viewport === v.key ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)]'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <a
          href={`/mx/s/${shop.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-sm px-3 py-1.5 rounded-lg border border-[var(--border)] no-underline text-[var(--fg)]"
        >
          Abrir la tienda publicada
        </a>
      </div>

      <p className="text-xs text-[var(--fg-muted)] mb-2">
        Así se vería con los cambios que aún no has guardado. Nadie más los ve todavía.
      </p>

      <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--bg-sunk)] flex justify-center">
        <iframe
          key={src}
          src={src}
          title="Vista previa de la tienda"
          className="bg-white"
          style={{ width: active.width, maxWidth: '100%', height: 640, border: 0 }}
        />
      </div>
    </div>
  )
}
