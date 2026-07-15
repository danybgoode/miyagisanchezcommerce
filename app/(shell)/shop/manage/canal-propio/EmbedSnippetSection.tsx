'use client'

/**
 * "Pon tu tienda en cualquier web" — the seller snippet generator
 * (07 · Embeddable Widget, Sprint 3 · US-6 + US-7).
 *
 * Mints-or-reveals the shop's publishable embed key and emits three ready-to-paste
 * snippets — buy-button, product card, and full-shop iframe — prefilled with the
 * seller's slug, key, and brand accent (US-7). A live preview renders the real
 * surfaces (the iframe is truly live; the button/card render once a listing id is
 * given) and a locale toggle demonstrates the bilingual support.
 *
 * The key is publishable (it ships in the snippet), so we show it freely. Nothing
 * here authorizes a payment or a write.
 */

import { createElement, useEffect, useRef, useState } from 'react'

// Canonical production origin — the snippet is pasted on third-party sites, so it
// must always point at prod, never a preview/localhost.
const ORIGIN = 'https://miyagisanchez.com'

type Surface = 'button' | 'card' | 'shop'

export default function EmbedSnippetSection({ slug, accent }: { slug: string; accent: string }) {
  // Defense-in-depth: this component only ever renders for the logged-in
  // seller's OWN shop, so `slug` should never be empty in practice — but an
  // unresolved-seller listing elsewhere in the catalog showed that a shop can
  // reach downstream consumers with an empty slug (see middleware.ts's
  // /embed/s/ guard, 2026-07-15), so never emit a broken `/embed/s/` snippet.
  if (!slug) {
    return (
      <section id="widget" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <p className="text-sm text-[var(--color-muted)]">El widget de tienda no está disponible por ahora.</p>
      </section>
    )
  }

  const [key, setKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [listingId, setListingId] = useState('')
  const [locale, setLocale] = useState<'es' | 'en'>('es')
  const [copied, setCopied] = useState<Surface | null>(null)
  const scriptLoaded = useRef(false)

  // Mint-or-reveal the publishable key on mount (GET get-or-creates).
  useEffect(() => {
    let alive = true
    fetch('/api/sell/embed-key')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: { key?: string }) => { if (alive) { setKey(d.key ?? null); setLoading(false) } })
      .catch(() => { if (alive) { setError(true); setLoading(false) } })
    return () => { alive = false }
  }, [])

  // Load the real loader once so the live preview renders the actual elements.
  useEffect(() => {
    if (scriptLoaded.current || typeof document === 'undefined') return
    if (document.querySelector('script[data-miyagi-embed]')) { scriptLoaded.current = true; return }
    const s = document.createElement('script')
    s.src = `${ORIGIN}/embed.js`
    s.async = true
    s.setAttribute('data-miyagi-embed', '1')
    document.head.appendChild(s)
    scriptLoaded.current = true
  }, [])

  async function rotate() {
    setRotating(true)
    try {
      const r = await fetch('/api/sell/embed-key', { method: 'POST' })
      const d = await r.json() as { key?: string }
      if (r.ok && d.key) setKey(d.key)
    } finally { setRotating(false) }
  }

  const k = key ?? 'emb_pk_…'
  const lid = listingId.trim() || 'prod_REEMPLAZA_CON_TU_ID'
  const accentAttr = accent && accent !== '#111' ? ` data-accent="${accent}"` : ''
  const localeAttr = locale === 'en' ? ' data-locale="en"' : ''

  const snippets: Record<Surface, string> = {
    button:
      `<script src="${ORIGIN}/embed.js" async></script>\n` +
      `<miyagi-buy-button data-listing="${lid}" data-key="${k}"${accentAttr}${localeAttr}></miyagi-buy-button>`,
    card:
      `<script src="${ORIGIN}/embed.js" async></script>\n` +
      `<miyagi-product data-listing="${lid}" data-key="${k}"${accentAttr}${localeAttr}></miyagi-product>`,
    shop:
      `<iframe src="${ORIGIN}/embed/s/${slug}?key=${k}"\n` +
      `        style="width:100%;height:760px;border:0" loading="lazy"></iframe>`,
  }

  async function copy(which: Surface) {
    try {
      await navigator.clipboard.writeText(snippets[which])
      setCopied(which)
      setTimeout(() => setCopied(c => (c === which ? null : c)), 1800)
    } catch { /* clipboard blocked — seller can select manually */ }
  }

  const hasListing = !!listingId.trim()
  // Remount the preview elements when inputs change so the loader re-runs.
  const previewKey = `${listingId}|${accent}|${locale}|${k}`

  return (
    <section id="widget" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-[var(--color-muted)]">
          Pon tu tienda en cualquier web
        </h2>
        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-surface-alt)] text-[var(--color-muted)]">Widget</span>
      </div>
      <p className="text-xs text-[var(--color-muted)] mb-4">
        Pega un fragmento en tu blog, Wix, WordPress o landing y vende desde ahí. Tus clientes
        compran en nuestro checkout seguro — <strong>nunca</strong> se piden datos de pago en tu página.
      </p>

      {loading ? (
        <p className="text-sm text-[var(--color-muted)]">Cargando tu llave…</p>
      ) : error ? (
        <p className="text-sm text-red-600">No se pudo cargar tu llave de widget. Recarga la página.</p>
      ) : (
        <div className="space-y-5">
          {/* Key + controls */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[var(--color-muted)]">Tu llave (pública):</span>
            <code className="px-2 py-1 rounded bg-[var(--color-surface-alt)] font-mono">{k}</code>
            <button
              type="button"
              onClick={rotate}
              disabled={rotating}
              className="text-[var(--color-muted)] hover:text-[var(--color-accent)] underline disabled:opacity-40"
            >
              {rotating ? 'Rotando…' : 'Rotar llave'}
            </button>
            <span className="text-[var(--color-muted)]">·</span>
            <span className="text-[var(--color-muted)]">Idioma:</span>
            <div className="inline-flex rounded-md overflow-hidden border border-[var(--color-border)]">
              {(['es', 'en'] as const).map(l => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLocale(l)}
                  className={`px-2 py-0.5 ${locale === l ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-muted)]'}`}
                >
                  {l === 'es' ? 'ES' : 'EN'}
                </button>
              ))}
            </div>
          </div>

          {/* Listing id input (for the button + card snippets) */}
          <div>
            <label className="block text-xs font-medium mb-1">ID de anuncio (para el botón y la tarjeta)</label>
            <input
              value={listingId}
              onChange={e => setListingId(e.target.value)}
              placeholder="prod_… — lo encuentras en la página de tu anuncio"
              className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </div>

          {/* The three snippets */}
          {([
            { id: 'button' as const, title: 'Botón de compra', desc: 'Un botón “Comprar” para un anuncio.' },
            { id: 'card' as const, title: 'Tarjeta de producto', desc: 'Foto, precio y condición de un anuncio.' },
            { id: 'shop' as const, title: 'Tienda completa', desc: 'Toda tu tienda dentro de un iframe.' },
          ]).map(s => (
            <div key={s.id} className="border border-[var(--color-border)] rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-surface-alt)]">
                <div>
                  <p className="text-sm font-semibold">{s.title}</p>
                  <p className="text-xs text-[var(--color-muted)]">{s.desc}</p>
                </div>
                <button
                  type="button"
                  onClick={() => copy(s.id)}
                  className="text-xs font-semibold px-3 py-1.5 rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
                >
                  {copied === s.id ? '¡Copiado!' : 'Copiar'}
                </button>
              </div>
              <pre className="text-xs p-3 overflow-x-auto bg-white whitespace-pre-wrap break-all font-mono text-[var(--color-foreground)]">{snippets[s.id]}</pre>

              {/* Live preview */}
              <div className="border-t border-[var(--color-border)] p-3 bg-[var(--color-surface-alt)]">
                <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)] mb-2">Vista previa</p>
                {s.id === 'shop' ? (
                  <iframe
                    title="Vista previa de la tienda"
                    src={`${ORIGIN}/embed/s/${slug}?key=${k}`}
                    style={{ width: '100%', height: 360, border: '1px solid var(--color-border)', borderRadius: 8 }}
                    loading="lazy"
                  />
                ) : hasListing ? (
                  createElement(s.id === 'button' ? 'miyagi-buy-button' : 'miyagi-product', {
                    key: previewKey,
                    'data-listing': listingId.trim(),
                    'data-key': k,
                    'data-accent': accent,
                    'data-locale': locale,
                  })
                ) : (
                  <p className="text-xs text-[var(--color-muted)]">Ingresa un ID de anuncio arriba para ver la vista previa.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
