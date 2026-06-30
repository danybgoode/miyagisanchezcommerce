'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Mercado Libre import review island (US-6). Fetches the connected seller's ML
 * listings, flags already-imported duplicates, and imports the selected ones.
 * es-MX. All work goes through the seller-scoped /api/sell/ml/import* routes.
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

type ImportResult = { imported: number; duplicate: number; failed: number }

function fmtPrice(cents: number | null, currency: string | null): string {
  if (cents == null) return 'A convenir'
  try {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' }).format(cents / 100)
  } catch {
    return `$${(cents / 100).toFixed(2)}`
  }
}

export default function MercadoLibreImport({ nickname }: { nickname: string | null }) {
  const router = useRouter()
  const [phase, setPhase] = useState<'idle' | 'fetching' | 'review' | 'importing'>('idle')
  const [batchId, setBatchId] = useState<string | null>(null)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  async function fetchItems() {
    setPhase('fetching')
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/sell/ml/import/fetch', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'No se pudieron traer tus publicaciones.')
      const items: ImportRow[] = data.items ?? []
      setBatchId(data.batchId ?? null)
      setRows(items)
      // Pre-select everything except the flagged duplicates.
      setSelected(new Set(items.filter((i) => i.status !== 'duplicate').map((i) => i.id)))
      setPhase('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al traer publicaciones.')
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
      const res = await fetch('/api/sell/ml/import', {
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
          Importadas {result.imported} · duplicadas {result.duplicate}
          {result.failed > 0 ? ` · con error ${result.failed}` : ''}.
        </div>
      )}

      {phase === 'idle' && (
        <div style={card}>
          <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--fg-muted)' }}>
            {nickname ? <>Cuenta conectada: <strong>{nickname}</strong>. </> : null}
            Trae tus publicaciones activas para revisarlas antes de importar.
          </p>
          <button
            type="button"
            onClick={fetchItems}
            style={{
              padding: '10px 16px', borderRadius: 'var(--r-md)', fontSize: 14, fontWeight: 600,
              background: 'var(--accent)', color: 'var(--fg-inverse)', border: 'none', cursor: 'pointer',
            }}
          >
            Traer mis publicaciones de Mercado Libre
          </button>
        </div>
      )}

      {phase === 'fetching' && (
        <div style={{ ...card, color: 'var(--fg-muted)', fontSize: 14 }}>Trayendo tus publicaciones…</div>
      )}

      {(phase === 'review' || phase === 'importing') && (
        <>
          {rows.length === 0 ? (
            <div style={{ ...card, color: 'var(--fg-muted)', fontSize: 14 }}>
              No encontramos publicaciones activas en tu cuenta de Mercado Libre.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
                  {rows.length} publicación(es) · {selected.size} seleccionada(s)
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
                  {phase === 'importing' ? 'Importando…' : `Importar seleccionadas (${selected.size})`}
                </button>
              </div>

              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rows.map((row) => {
                  const isDup = row.status === 'duplicate'
                  const img = row.images?.[0]?.url
                  return (
                    <li
                      key={row.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: 12,
                        borderRadius: 'var(--r-md)', border: '1px solid var(--border)',
                        background: 'var(--bg-elevated)', opacity: isDup && !selected.has(row.id) ? 0.7 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggle(row.id)}
                        aria-label={`Importar ${row.listing_title ?? 'publicación'}`}
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
                      {isDup && (
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--warning)', background: 'var(--warning-soft)', padding: '3px 8px', borderRadius: 'var(--r-sm)', flexShrink: 0 }}>
                          Ya importada
                        </span>
                      )}
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
