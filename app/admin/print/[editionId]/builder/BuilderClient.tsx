'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { PrintTier, PrintAdSubmission } from '@/lib/print'
import {
  emptyDocument, placedSubmissionIds, submissionToBlock, newPage, newId,
  blockSize, spanKeyOf, densityRows,
  PRINT_PAGE_DIMS, PRINT_SPAN_PRESETS,
  type PrintLayoutDocument, type PrintPageSize, type PrintDensity, type PrintSpanKey, type PrintPage,
} from '@/lib/print-layout'
import PrintAdBlock from '@/app/components/PrintAdBlock'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * US-0 + US-1: load the layout, list APPROVED ads in a tray, place them onto
 * fractional grid pages (4-grid / 8-grid density), auto-pack a whole batch, resize
 * blocks (¼ / ½ / plana), and autosave. Drag/drop + merge land in US-2.
 */
export default function BuilderClient({
  secret, editionId, editionTitle, tiers,
}: {
  secret: string
  editionId: string
  editionTitle: string
  tiers: PrintTier[]
}) {
  const [doc, setDoc] = useState<PrintLayoutDocument>(() => emptyDocument(4))
  const [pageSize, setPageSize] = useState<PrintPageSize>('carta')
  const [subs, setSubs] = useState<PrintAdSubmission[]>([])
  const [loaded, setLoaded] = useState(false)
  const [save, setSave] = useState<SaveState>('idle')

  const api = useCallback(
    (path: string, init?: RequestInit) =>
      fetch(`/api/admin/print${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret, ...(init?.headers ?? {}) },
      }),
    [secret],
  )

  const tierLabel = useCallback(
    (key: string | null | undefined) => tiers.find((t) => t.key === key)?.label ?? key ?? '',
    [tiers],
  )

  // Initial load: layout + approved submissions.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const [layoutRes, subsRes] = await Promise.all([
        api(`/editions/${editionId}/layout`).then((r) => r.json()).catch(() => null),
        api(`/editions/${editionId}/submissions`).then((r) => r.json()).catch(() => null),
      ])
      if (!alive) return
      if (layoutRes?.layout?.document?.pages) {
        setDoc(layoutRes.layout.document)
        setPageSize(layoutRes.layout.page_size === 'media_carta' ? 'media_carta' : 'carta')
      }
      setSubs((subsRes?.submissions ?? []).filter((s: PrintAdSubmission) => s.status === 'approved'))
      setLoaded(true)
    })()
    return () => { alive = false }
  }, [api, editionId])

  // Debounced autosave whenever the document or page size changes (post-load).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!loaded) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setSave('saving')
      const res = await api(`/editions/${editionId}/layout`, {
        method: 'PUT',
        body: JSON.stringify({ page_size: pageSize, document: doc }),
      })
      setSave(res.ok ? 'saved' : 'error')
    }, 800)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [doc, pageSize, loaded, api, editionId])

  // ── Mutations ────────────────────────────────────────────────────────────────
  const placed = placedSubmissionIds(doc)
  const tray = subs.filter((s) => !placed.has(s.id))
  const dims = PRINT_PAGE_DIMS[pageSize]

  const mutatePage = (pageId: string, fn: (p: PrintPage) => PrintPage) =>
    setDoc((d) => ({ ...d, pages: d.pages.map((p) => (p.id === pageId ? fn(p) : p)) }))

  function placeOnPage(sub: PrintAdSubmission, pageId: string) {
    mutatePage(pageId, (p) => ({ ...p, blocks: [...p.blocks, submissionToBlock(sub)] }))
  }
  function removeBlock(pageId: string, blockId: string) {
    mutatePage(pageId, (p) => ({ ...p, blocks: p.blocks.filter((b) => b.id !== blockId) }))
  }
  function setBlockSpan(pageId: string, blockId: string, key: PrintSpanKey) {
    mutatePage(pageId, (p) => ({
      ...p,
      blocks: p.blocks.map((b) => (b.id === blockId ? { ...b, span: { ...PRINT_SPAN_PRESETS[key].span } } : b)),
    }))
  }
  function setPageDensity(pageId: string, density: PrintDensity) {
    mutatePage(pageId, (p) => ({ ...p, density }))
  }
  function addPage() {
    setDoc((d) => ({ ...d, pages: [...d.pages, newPage(d.density_default)] }))
  }
  function removePage(pageId: string) {
    setDoc((d) => (d.pages.length <= 1 ? d : { ...d, pages: d.pages.filter((p) => p.id !== pageId) }))
  }
  function setDefaultDensity(density: PrintDensity) {
    setDoc((d) => ({ ...d, density_default: density }))
  }

  /** Sequentially pack every approved ad into fresh pages at the default density. */
  function autoPack() {
    if (subs.length === 0) return
    if (placed.size > 0 && !confirm('Esto reemplaza la maqueta actual con un acomodo automático de todos los anuncios aprobados. ¿Continuar?')) return
    const density = doc.density_default
    const pages: PrintPage[] = []
    for (let i = 0; i < subs.length; i += density) {
      pages.push({ id: newId(), kind: 'grid', density, blocks: subs.slice(i, i + density).map(submissionToBlock) })
    }
    setDoc((d) => ({ ...d, pages: pages.length ? pages : [newPage(density)] }))
  }

  const saveLabel = save === 'saving' ? 'Guardando…' : save === 'saved' ? 'Guardado ✓' : save === 'error' ? 'Error al guardar' : ''

  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3 min-w-0">
          <Link href={`/admin/print?secret=${encodeURIComponent(secret)}`} className="text-sm text-[var(--color-accent)] no-underline flex-shrink-0">← Admin</Link>
          <div className="min-w-0">
            <h1 className="font-bold text-sm truncate">Maqueta · {editionTitle}</h1>
            <p className="text-xs text-[var(--color-muted)]">{doc.pages.length} página(s) · {placed.size} colocado(s) · {tray.length} en bandeja</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <label className="text-xs text-[var(--color-muted)]">Densidad
            <select value={doc.density_default} onChange={(e) => setDefaultDensity(Number(e.target.value) as PrintDensity)}
              className="ml-1 rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs bg-transparent">
              <option value={4}>4 por página</option>
              <option value={8}>8 por página</option>
            </select>
          </label>
          <label className="text-xs text-[var(--color-muted)]">Tamaño
            <select value={pageSize} onChange={(e) => setPageSize(e.target.value as PrintPageSize)}
              className="ml-1 rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs bg-transparent">
              {(Object.keys(PRINT_PAGE_DIMS) as PrintPageSize[]).map((k) => (
                <option key={k} value={k}>{PRINT_PAGE_DIMS[k].label}</option>
              ))}
            </select>
          </label>
          <span className={`text-xs ${save === 'error' ? 'text-red-600' : 'text-[var(--color-muted)]'}`}>{saveLabel}</span>
        </div>
      </header>

      <div className="flex">
        {/* Tray of unplaced approved ads */}
        <aside className="w-60 flex-shrink-0 border-r border-[var(--color-border)] p-3 space-y-2 max-h-[calc(100vh-57px)] overflow-y-auto sticky top-[57px]">
          <button onClick={autoPack} disabled={subs.length === 0}
            className="w-full rounded-lg bg-[var(--color-accent)] text-white py-1.5 text-xs font-semibold disabled:opacity-40">
            ⚡ Auto-acomodar ({subs.length})
          </button>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] pt-1">Bandeja ({tray.length})</h2>
          {!loaded && <p className="text-xs text-[var(--color-muted)]">Cargando…</p>}
          {loaded && tray.length === 0 && (
            <p className="text-xs text-[var(--color-muted)]">
              {subs.length === 0 ? 'No hay anuncios aprobados todavía. Apruébalos en la cola de la edición.' : 'Todos los anuncios están colocados.'}
            </p>
          )}
          {tray.map((s) => (
            <div key={s.id} className="rounded-lg border border-[var(--color-border)] p-2 text-xs">
              <div className="font-medium truncate">{s.content?.headline || '(sin titular)'}</div>
              <div className="text-[var(--color-muted)] truncate">{tierLabel(s.tier_key)} · {s.buyer_email ?? 's/email'}</div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {doc.pages.map((p, i) => (
                  <button key={p.id} onClick={() => placeOnPage(s, p.id)}
                    className="rounded border border-[var(--color-border)] px-1.5 py-0.5 hover:bg-[var(--color-accent)] hover:text-white">
                    + P{i + 1}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        {/* Pages */}
        <main className="flex-1 p-6 space-y-10 bg-[color-mix(in_srgb,var(--color-muted)_8%,transparent)]">
          {doc.pages.map((page, i) => (
            <section key={page.id} className="mx-auto" style={{ maxWidth: 560 }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Página {i + 1}</span>
                <div className="flex items-center gap-3">
                  <label className="text-xs text-[var(--color-muted)]">
                    <select value={page.density} onChange={(e) => setPageDensity(page.id, Number(e.target.value) as PrintDensity)}
                      className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-xs bg-transparent">
                      <option value={4}>4-grid</option>
                      <option value={8}>8-grid</option>
                    </select>
                  </label>
                  {doc.pages.length > 1 && (
                    <button onClick={() => removePage(page.id)} className="text-xs text-red-600">Quitar</button>
                  )}
                </div>
              </div>
              <div className="relative bg-white shadow-sm border border-[var(--color-border)]" style={{ aspectRatio: `${dims.w_mm} / ${dims.h_mm}` }}>
                <div className="absolute inset-0 grid gap-1.5 p-1.5"
                  style={{ gridTemplateColumns: 'repeat(2, 1fr)', gridTemplateRows: `repeat(${densityRows(page.density)}, 1fr)`, gridAutoRows: '1fr', gridAutoFlow: 'dense' }}>
                  {page.blocks.map((b) => (
                    <div key={b.id} className="relative group min-h-0" style={{ gridColumn: `span ${b.span.col}`, gridRow: `span ${b.span.row}` }}>
                      <PrintAdBlock block={b} tierLabel={tierLabel(b.tier_key)} size={blockSize(page.density, b.span)} />
                      {/* Hover toolbar */}
                      <div className="absolute right-1 top-1 z-10 hidden group-hover:flex items-center gap-1">
                        <select value={spanKeyOf(b.span)} onChange={(e) => setBlockSpan(page.id, b.id, e.target.value as PrintSpanKey)}
                          className="rounded bg-black/70 text-white text-[10px] px-1 py-0.5 border-0">
                          {(Object.keys(PRINT_SPAN_PRESETS) as PrintSpanKey[]).map((k) => (
                            <option key={k} value={k}>{PRINT_SPAN_PRESETS[k].label}</option>
                          ))}
                        </select>
                        <button onClick={() => removeBlock(page.id, b.id)} title="Quitar"
                          className="h-5 w-5 rounded-full bg-black/70 text-white text-xs leading-none grid place-items-center">×</button>
                      </div>
                    </div>
                  ))}
                </div>
                {page.blocks.length === 0 && (
                  <div className="absolute inset-0 grid place-items-center text-xs text-[var(--color-muted)] pointer-events-none">
                    Vacía — coloca anuncios con “+ P{i + 1}” o usa Auto-acomodar.
                  </div>
                )}
              </div>
            </section>
          ))}
          <div className="mx-auto" style={{ maxWidth: 560 }}>
            <button onClick={addPage} className="w-full rounded-xl border-2 border-dashed border-[var(--color-border)] py-3 text-sm text-[var(--color-accent)] hover:bg-white">
              + Agregar página
            </button>
          </div>
        </main>
      </div>
    </div>
  )
}
