'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent,
} from '@dnd-kit/core'
import type { PrintTier, PrintAdSubmission, PrintSocialSubmission } from '@/lib/print'
import {
  emptyDocument, placedSubmissionIds, placedSocialIds, submissionToBlock, socialToBlock,
  newPage, newId, newEditorialBlock, blockSize, spanKeyOf, densityRows,
  PRINT_PAGE_DIMS, PRINT_SPAN_PRESETS,
  type PrintLayoutDocument, type PrintPageSize, type PrintDensity, type PrintSpanKey, type PrintPage, type PrintBlock,
} from '@/lib/print-layout'
import PrintAdBlock from '@/app/components/PrintAdBlock'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Printed-edition builder. US-0/1: load + tray + fractional grid + auto-pack.
 * US-2: drag/drop reorder across pages, merge blocks, inject editorial (cover /
 * section / filler) + approved social items. US-3 adds the per-block inspector.
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
  const [social, setSocial] = useState<PrintSocialSubmission[]>([])
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

  // Initial load: layout + approved submissions + approved social for this edition.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const [layoutRes, subsRes, socialRes] = await Promise.all([
        api(`/editions/${editionId}/layout`).then((r) => r.json()).catch(() => null),
        api(`/editions/${editionId}/submissions`).then((r) => r.json()).catch(() => null),
        api(`/social?status=approved`).then((r) => r.json()).catch(() => null),
      ])
      if (!alive) return
      if (layoutRes?.layout?.document?.pages) {
        setDoc(layoutRes.layout.document)
        setPageSize(layoutRes.layout.page_size === 'media_carta' ? 'media_carta' : 'carta')
      }
      setSubs((subsRes?.submissions ?? []).filter((s: PrintAdSubmission) => s.status === 'approved'))
      setSocial((socialRes?.submissions ?? []).filter((s: PrintSocialSubmission) => s.edition_id === editionId))
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

  // ── Derived ─────────────────────────────────────────────────────────────────
  const placedSubs = useMemo(() => placedSubmissionIds(doc), [doc])
  const placedSoc = useMemo(() => placedSocialIds(doc), [doc])
  const tray = subs.filter((s) => !placedSubs.has(s.id))
  const socialTray = social.filter((s) => !placedSoc.has(s.id))
  const dims = PRINT_PAGE_DIMS[pageSize]

  // ── Mutations ────────────────────────────────────────────────────────────────
  const mutatePage = (pageId: string, fn: (p: PrintPage) => PrintPage) =>
    setDoc((d) => ({ ...d, pages: d.pages.map((p) => (p.id === pageId ? fn(p) : p)) }))

  function appendBlock(pageId: string, block: PrintBlock) {
    mutatePage(pageId, (p) => ({ ...p, blocks: [...p.blocks, block] }))
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
  /** Merge: grow this block to a half and absorb the next block's slot (freeing it). */
  function mergeWithNext(pageId: string, blockId: string) {
    mutatePage(pageId, (p) => {
      const idx = p.blocks.findIndex((b) => b.id === blockId)
      if (idx < 0) return p
      const blocks = [...p.blocks]
      blocks[idx] = { ...blocks[idx], span: { col: 2, row: 1 } }
      if (idx + 1 < blocks.length) blocks.splice(idx + 1, 1)
      return { ...p, blocks }
    })
  }
  function editLabel(pageId: string, blockId: string, current: string) {
    const label = window.prompt('Texto:', current)
    if (label == null) return
    mutatePage(pageId, (p) => ({
      ...p,
      blocks: p.blocks.map((b) => (b.id === blockId ? { ...b, content: { ...b.content, label } } : b)),
    }))
  }
  function setPageDensity(pageId: string, density: PrintDensity) {
    mutatePage(pageId, (p) => ({ ...p, density }))
  }
  function insertEditorial(pageId: string, kind: 'section' | 'filler') {
    const label = window.prompt(kind === 'section' ? 'Título de la sección:' : 'Texto del relleno:') ?? ''
    appendBlock(pageId, newEditorialBlock(kind, label))
  }
  function addPage() {
    setDoc((d) => ({ ...d, pages: [...d.pages, newPage(d.density_default)] }))
  }
  function addCoverPage() {
    const label = window.prompt('Título de portada:') ?? ''
    setDoc((d) => ({ ...d, pages: [...d.pages, { id: newId(), kind: 'cover', density: 4, blocks: [newEditorialBlock('cover', label)] }] }))
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
    if (placedSubs.size > 0 && !window.confirm('Esto reemplaza la maqueta actual con un acomodo automático de todos los anuncios aprobados. ¿Continuar?')) return
    const density = doc.density_default
    const pages: PrintPage[] = []
    for (let i = 0; i < subs.length; i += density) {
      pages.push({ id: newId(), kind: 'grid', density, blocks: subs.slice(i, i + density).map(submissionToBlock) })
    }
    setDoc((d) => ({ ...d, pages: pages.length ? pages : [newPage(density)] }))
  }

  // ── Drag & drop (reorder within / across pages) ──────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  function onDragEnd(e: DragEndEvent) {
    const blockId = String(e.active.id)
    const overId = e.over ? String(e.over.id) : null
    if (!overId) return
    setDoc((d) => moveBlock(d, blockId, overId))
  }

  const saveLabel = save === 'saving' ? 'Guardando…' : save === 'saved' ? 'Guardado ✓' : save === 'error' ? 'Error al guardar' : ''

  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3 min-w-0">
          <Link href={`/admin/print?secret=${encodeURIComponent(secret)}`} className="text-sm text-[var(--color-accent)] no-underline flex-shrink-0">← Admin</Link>
          <div className="min-w-0">
            <h1 className="font-bold text-sm truncate">Maqueta · {editionTitle}</h1>
            <p className="text-xs text-[var(--color-muted)]">{doc.pages.length} página(s) · {placedSubs.size} colocado(s) · {tray.length} en bandeja</p>
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

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex">
          {/* Tray */}
          <aside className="w-60 flex-shrink-0 border-r border-[var(--color-border)] p-3 space-y-2 max-h-[calc(100vh-57px)] overflow-y-auto sticky top-[57px]">
            <button onClick={autoPack} disabled={subs.length === 0}
              className="w-full rounded-lg bg-[var(--color-accent)] text-white py-1.5 text-xs font-semibold disabled:opacity-40">
              ⚡ Auto-acomodar ({subs.length})
            </button>

            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] pt-1">Anuncios ({tray.length})</h2>
            {!loaded && <p className="text-xs text-[var(--color-muted)]">Cargando…</p>}
            {loaded && tray.length === 0 && (
              <p className="text-xs text-[var(--color-muted)]">
                {subs.length === 0 ? 'No hay anuncios aprobados todavía.' : 'Todos colocados.'}
              </p>
            )}
            {tray.map((s) => (
              <TrayCard key={s.id} title={s.content?.headline || '(sin titular)'} subtitle={`${tierLabel(s.tier_key)} · ${s.buyer_email ?? 's/email'}`}
                pages={doc.pages} onPlace={(pageId) => appendBlock(pageId, submissionToBlock(s))} />
            ))}

            {socialTray.length > 0 && (
              <>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] pt-2">Social ({socialTray.length})</h2>
                {socialTray.map((s) => (
                  <TrayCard key={s.id} title={s.caption} subtitle={s.submitter_name ?? s.type}
                    pages={doc.pages} onPlace={(pageId) => appendBlock(pageId, socialToBlock(s))} />
                ))}
              </>
            )}
          </aside>

          {/* Pages */}
          <main className="flex-1 p-6 space-y-10 bg-[color-mix(in_srgb,var(--color-muted)_8%,transparent)]">
            {doc.pages.map((page, i) => (
              <section key={page.id} className="mx-auto" style={{ maxWidth: 560 }}>
                <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Página {i + 1}</span>
                  <div className="flex items-center gap-2">
                    <select value="" onChange={(e) => { if (e.target.value) { insertEditorial(page.id, e.target.value as 'section' | 'filler'); e.target.value = '' } }}
                      className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-xs bg-transparent text-[var(--color-muted)]">
                      <option value="">+ Insertar…</option>
                      <option value="section">Encabezado de sección</option>
                      <option value="filler">Relleno</option>
                    </select>
                    <select value={page.density} onChange={(e) => setPageDensity(page.id, Number(e.target.value) as PrintDensity)}
                      className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-xs bg-transparent">
                      <option value={4}>4-grid</option>
                      <option value={8}>8-grid</option>
                    </select>
                    {doc.pages.length > 1 && <button onClick={() => removePage(page.id)} className="text-xs text-red-600">Quitar</button>}
                  </div>
                </div>
                <PageGrid page={page} dims={dims}
                  tierLabel={tierLabel}
                  onSpan={(blockId, key) => setBlockSpan(page.id, blockId, key)}
                  onMerge={(blockId) => mergeWithNext(page.id, blockId)}
                  onEditLabel={(blockId, cur) => editLabel(page.id, blockId, cur)}
                  onRemove={(blockId) => removeBlock(page.id, blockId)}
                  placeholderHint={`+ P${i + 1}`} />
              </section>
            ))}
            <div className="mx-auto flex gap-2" style={{ maxWidth: 560 }}>
              <button onClick={addPage} className="flex-1 rounded-xl border-2 border-dashed border-[var(--color-border)] py-3 text-sm text-[var(--color-accent)] hover:bg-white">+ Agregar página</button>
              <button onClick={addCoverPage} className="flex-1 rounded-xl border-2 border-dashed border-[var(--color-border)] py-3 text-sm text-[var(--color-accent)] hover:bg-white">+ Página de portada</button>
            </div>
          </main>
        </div>
      </DndContext>
    </div>
  )
}

// ── Document move helper (drag end) ────────────────────────────────────────────

function moveBlock(d: PrintLayoutDocument, blockId: string, overId: string): PrintLayoutDocument {
  let moved: PrintBlock | undefined
  const pruned = d.pages.map((p) => {
    const idx = p.blocks.findIndex((b) => b.id === blockId)
    if (idx < 0) return p
    moved = p.blocks[idx]
    return { ...p, blocks: p.blocks.filter((b) => b.id !== blockId) }
  })
  if (!moved) return d

  if (overId.startsWith('page:')) {
    const dst = overId.slice(5)
    return { ...d, pages: pruned.map((p) => (p.id === dst ? { ...p, blocks: [...p.blocks, moved!] } : p)) }
  }
  if (overId.startsWith('block:')) {
    const targetId = overId.slice(6)
    if (targetId === blockId) return d
    return {
      ...d,
      pages: pruned.map((p) => {
        const idx = p.blocks.findIndex((b) => b.id === targetId)
        if (idx < 0) return p
        const blocks = [...p.blocks]
        blocks.splice(idx, 0, moved!)
        return { ...p, blocks }
      }),
    }
  }
  return d
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function TrayCard({ title, subtitle, pages, onPlace }: {
  title: string; subtitle: string; pages: PrintPage[]; onPlace: (pageId: string) => void
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] p-2 text-xs">
      <div className="font-medium truncate">{title}</div>
      <div className="text-[var(--color-muted)] truncate">{subtitle}</div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {pages.map((p, i) => (
          <button key={p.id} onClick={() => onPlace(p.id)}
            className="rounded border border-[var(--color-border)] px-1.5 py-0.5 hover:bg-[var(--color-accent)] hover:text-white">
            + P{i + 1}
          </button>
        ))}
      </div>
    </div>
  )
}

function PageGrid({ page, dims, tierLabel, onSpan, onMerge, onEditLabel, onRemove, placeholderHint }: {
  page: PrintPage
  dims: { w_mm: number; h_mm: number }
  tierLabel: (k: string | null | undefined) => string
  onSpan: (blockId: string, key: PrintSpanKey) => void
  onMerge: (blockId: string) => void
  onEditLabel: (blockId: string, current: string) => void
  onRemove: (blockId: string) => void
  placeholderHint: string
}) {
  const { setNodeRef } = useDroppable({ id: `page:${page.id}` })
  return (
    <div ref={setNodeRef} className="relative bg-white shadow-sm border border-[var(--color-border)]" style={{ aspectRatio: `${dims.w_mm} / ${dims.h_mm}` }}>
      <div className="absolute inset-0 grid gap-1.5 p-1.5"
        style={{ gridTemplateColumns: 'repeat(2, 1fr)', gridTemplateRows: `repeat(${densityRows(page.density)}, 1fr)`, gridAutoRows: '1fr', gridAutoFlow: 'dense' }}>
        {page.blocks.map((b) => (
          <BlockSlot key={b.id} block={b} density={page.density} tierLabel={tierLabel(b.tier_key)}
            onSpan={(key) => onSpan(b.id, key)} onMerge={() => onMerge(b.id)}
            onEditLabel={() => onEditLabel(b.id, b.content.label ?? '')} onRemove={() => onRemove(b.id)} />
        ))}
      </div>
      {page.blocks.length === 0 && (
        <div className="absolute inset-0 grid place-items-center text-xs text-[var(--color-muted)] pointer-events-none">
          Vacía — coloca con “{placeholderHint}”, Auto-acomodar o arrastra aquí.
        </div>
      )}
    </div>
  )
}

function BlockSlot({ block, density, tierLabel, onSpan, onMerge, onEditLabel, onRemove }: {
  block: PrintBlock
  density: PrintDensity
  tierLabel: string
  onSpan: (key: PrintSpanKey) => void
  onMerge: () => void
  onEditLabel: () => void
  onRemove: () => void
}) {
  const { setNodeRef: setDropRef } = useDroppable({ id: `block:${block.id}` })
  const { setNodeRef: setDragRef, listeners, attributes, transform } = useDraggable({ id: block.id })
  const dragStyle = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 40, opacity: 0.85 }
    : undefined
  const isEditorial = block.kind !== 'ad'
  return (
    <div ref={setDropRef} className="relative group min-h-0" style={{ gridColumn: `span ${block.span.col}`, gridRow: `span ${block.span.row}` }}>
      <div ref={setDragRef} {...listeners} {...attributes} style={dragStyle}
        className="h-full w-full cursor-grab active:cursor-grabbing touch-none">
        <PrintAdBlock block={block} tierLabel={tierLabel} size={blockSize(density, block.span)} />
      </div>
      <div className="absolute right-1 top-1 z-10 hidden group-hover:flex items-center gap-1">
        {isEditorial && (
          <button onClick={onEditLabel} title="Editar texto" className="h-5 px-1 rounded bg-black/70 text-white text-[10px] leading-none grid place-items-center">✎</button>
        )}
        <select value={spanKeyOf(block.span)} onChange={(e) => onSpan(e.target.value as PrintSpanKey)}
          className="rounded bg-black/70 text-white text-[10px] px-1 py-0.5 border-0">
          {(Object.keys(PRINT_SPAN_PRESETS) as PrintSpanKey[]).map((k) => (
            <option key={k} value={k}>{PRINT_SPAN_PRESETS[k].label}</option>
          ))}
        </select>
        {block.span.col === 1 && block.span.row === 1 && (
          <button onClick={onMerge} title="Fusionar con el siguiente" className="h-5 w-5 rounded bg-black/70 text-white text-xs leading-none grid place-items-center">⤢</button>
        )}
        <button onClick={onRemove} title="Quitar" className="h-5 w-5 rounded-full bg-black/70 text-white text-xs leading-none grid place-items-center">×</button>
      </div>
    </div>
  )
}
