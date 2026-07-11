'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

/**
 * Shopify import review island (epic 03 · platform-migrations S1 · US-1.1).
 * Enters a shop domain, pulls the catalog + policies into a staged supply
 * batch, and reviews/imports the selected products. es-MX. All work goes
 * through the seller-scoped /api/sell/shopify/import* routes. Mirrors
 * MercadoLibreImport.tsx's phase state machine, with a domain-input step
 * before "fetching" (Shopify needs no prior connection).
 */

type ImportRow = {
  id: string
  listing_title: string | null
  price_cents: number | null
  currency: string | null
  status: string
  source_url: string | null
  images: Array<{ url: string; alt?: string | null }> | null
}

type FetchResult = { imported: number; duplicate: number; failed: number }

function fmtPrice(cents: number | null, currency: string | null): string {
  if (cents == null) return 'A convenir'
  try {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' }).format(cents / 100)
  } catch {
    return `$${(cents / 100).toFixed(2)}`
  }
}

export default function ShopifyImport() {
  const router = useRouter()
  const [domain, setDomain] = useState('')
  const [phase, setPhase] = useState<'idle' | 'fetching' | 'review' | 'importing'>('idle')
  const [batchId, setBatchId] = useState<string | null>(null)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<FetchResult | null>(null)

  async function fetchItems() {
    if (!domain.trim()) {
      setError('Ingresa el dominio de la tienda Shopify.')
      return
    }
    setPhase('fetching')
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/sell/shopify/import/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_domain: domain.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'No pudimos traer el catálogo.')
      const items: ImportRow[] = data.items ?? []
      setBatchId(data.batchId ?? null)
      setRows(items)
      setSelected(new Set(items.map((i) => i.id)))
      setPhase('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al traer el catálogo.')
      setPhase('idle')
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function importSelected() {
    if (!batchId || selected.size === 0) return
    setPhase('importing')
    setError(null)
    try {
      const res = await fetch('/api/sell/shopify/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, itemIds: [...selected] }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'No se pudo importar.')
      setResult({ imported: data.imported ?? 0, duplicate: data.duplicate ?? 0, failed: data.failed ?? 0 })
      setPhase('review')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al importar.')
      setPhase('review')
    }
  }

  const card: React.CSSProperties = {
    padding: 18,
    borderRadius: 'var(--r-lg)',
    border: '1.5px solid var(--border)',
    background: 'var(--bg-elevated)',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && (
        <div style={{ padding: '12px 14px', borderRadius: 'var(--r-md)', background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 14 }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ padding: '12px 14px', borderRadius: 'var(--r-md)', background: 'var(--success-soft)', color: 'var(--success)', fontSize: 14 }}>
          Importados {result.imported} · duplicados {result.duplicate}
          {result.failed > 0 ? ` · con error ${result.failed}` : ''}.
          {batchId && (
            <>
              {' '}
              <Link href={`/shop/manage/shopify/import/parity/${batchId}`} style={{ textDecoration: 'underline' }}>
                Ver reporte de paridad →
              </Link>
            </>
          )}
        </div>
      )}

      {phase === 'idle' && (
        <div style={card}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Dominio de tu tienda Shopify
          </label>
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="mitienda.com o mitienda.myshopify.com"
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)',
              background: 'var(--bg)', color: 'var(--fg)', fontSize: 14, marginBottom: 12,
            }}
          />
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--fg-muted)' }}>
            Traemos tu catálogo y políticas directamente desde tu tienda — no necesitas conectar ninguna cuenta.
          </p>
          <button
            type="button"
            onClick={fetchItems}
            style={{
              padding: '10px 16px', borderRadius: 'var(--r-md)', fontSize: 14, fontWeight: 600,
              background: 'var(--accent)', color: 'var(--fg-inverse)', border: 'none', cursor: 'pointer',
            }}
          >
            Traer mi catálogo de Shopify
          </button>
        </div>
      )}

      {phase === 'fetching' && (
        <div style={{ ...card, color: 'var(--fg-muted)', fontSize: 14 }}>Trayendo tu catálogo…</div>
      )}

      {(phase === 'review' || phase === 'importing') && (
        <>
          {rows.length === 0 ? (
            <div style={{ ...card, color: 'var(--fg-muted)', fontSize: 14 }}>
              No encontramos productos en esa tienda.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
                  {rows.length} producto(s) · {selected.size} seleccionado(s)
                </span>
                <button
                  type="button"
                  onClick={importSelected}
                  disabled={selected.size === 0 || phase === 'importing'}
                  style={{
                    padding: '10px 16px', borderRadius: 'var(--r-md)', fontSize: 14, fontWeight: 600,
                    background: 'var(--accent)', color: 'var(--fg-inverse)', border: 'none',
                    cursor: selected.size === 0 || phase === 'importing' ? 'default' : 'pointer',
                    opacity: selected.size === 0 || phase === 'importing' ? 0.6 : 1,
                  }}
                >
                  {phase === 'importing' ? 'Importando…' : `Importar seleccionados (${selected.size})`}
                </button>
              </div>

              {batchId && !result && (
                <Link
                  href={`/shop/manage/shopify/import/parity/${batchId}`}
                  style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'underline' }}
                >
                  Ver reporte de paridad antes de importar →
                </Link>
              )}

              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rows.map((row) => {
                  const img = row.images?.[0]?.url
                  return (
                    <li
                      key={row.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: 12,
                        borderRadius: 'var(--r-md)', border: '1px solid var(--border)',
                        background: 'var(--bg-elevated)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggle(row.id)}
                        aria-label={`Importar ${row.listing_title ?? 'producto'}`}
                        style={{ width: 18, height: 18, flexShrink: 0 }}
                      />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {img ? (
                        <img src={img} alt="" width={44} height={44} style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 'var(--r-sm)', flexShrink: 0 }} />
                      ) : (
                        <span style={{ width: 44, height: 44, borderRadius: 'var(--r-sm)', background: 'var(--bg-sunk)', flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {row.listing_title ?? 'Sin título'}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>{fmtPrice(row.price_cents, row.currency)}</div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}
