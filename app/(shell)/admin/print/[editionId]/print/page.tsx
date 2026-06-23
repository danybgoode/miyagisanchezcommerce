import { redirect } from 'next/navigation'
import { db } from '@/lib/supabase'
import { currentUserIsAdmin } from '@/lib/admin/guard'
import { loadLayoutOrEmpty, upsertLayout } from '@/lib/print-layout-server'
import { ensureLayoutQrs } from '@/lib/print-qr'
import { densityRows, blockSize, PRINT_PAGE_DIMS } from '@/lib/print-layout'
import type { PrintTier } from '@/lib/print'
import PrintAdBlock from '@/app/components/PrintAdBlock'
import PrintToolbar from './PrintToolbar'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Impresión — Edición impresa' }

const BLEED = 3 // mm — standard commercial print bleed

/**
 * US-5a — browser print-CSS view. Renders the saved layout at exact paper
 * dimensions (Carta / Media Carta) + 3mm bleed + corner crop marks, isolated from
 * the site chrome via @media print. The admin uses the browser's "Save as PDF".
 * Vector text + the original (hi-res) R2 image URLs already in each block survive
 * straight through. True CMYK/full-bleed art is the Cloud-Run engine's job (US-5b).
 *
 * Auth is **dual** by necessity: a Clerk admin (the human "Vista de impresión")
 * OR `?secret=ADMIN_SECRET` — the **machine** path, since the US-5b headless
 * Chromium renderer (`/api/admin/print/editions/[id]/pdf`) has no Clerk session.
 * This is a documented `ADMIN_SECRET` machine exception (S2.3).
 */
export default async function PrintViewPage({
  params, searchParams,
}: {
  params: Promise<{ editionId: string }>
  searchParams: Promise<{ secret?: string }>
}) {
  const { secret } = await searchParams
  const adminSecret = process.env.ADMIN_SECRET
  const secretOk = Boolean(adminSecret) && secret === adminSecret
  if (!secretOk && !(await currentUserIsAdmin())) redirect('/')
  const { editionId } = await params

  const { data: edition } = (await db
    .from('print_editions').select('title, tiers').eq('id', editionId).maybeSingle()) as
    { data: { title: string; tiers: PrintTier[] } | null }
  if (!edition) redirect('/admin/print')

  const layout = await loadLayoutOrEmpty(editionId)
  // Fill any missing QR codes (catalog/house ads + paid blocks) so the print proof is scannable.
  const { document, changed } = await ensureLayoutQrs(editionId, layout.document)
  if (changed && !layout.locked_at) {
    try { await upsertLayout(editionId, { page_size: layout.page_size, document }) } catch { /* render anyway */ }
  }
  const dims = (PRINT_PAGE_DIMS[layout.page_size] ?? PRINT_PAGE_DIMS.carta)
  const pageW = dims.w_mm + BLEED * 2
  const pageH = dims.h_mm + BLEED * 2
  const tierLabel = (k: string | null | undefined) => edition.tiers?.find((t) => t.key === k)?.label ?? ''

  const css = `
    @page { size: ${pageW}mm ${pageH}mm; margin: 0; }
    .print-root { position: fixed; inset: 0; overflow: auto; background: #555; z-index: 9999; padding: 56px 0 24px; }
    .sheet { width: ${pageW}mm; height: ${pageH}mm; background: #fff; position: relative; margin: 0 auto 16px; box-shadow: 0 2px 12px rgba(0,0,0,.4); overflow: hidden; page-break-after: always; }
    .sheet:last-of-type { page-break-after: auto; }
    .trim { position: absolute; top: ${BLEED}mm; left: ${BLEED}mm; right: ${BLEED}mm; bottom: ${BLEED}mm; }
    .pgrid { position: absolute; inset: 0; display: grid; gap: 1.5mm; grid-template-columns: repeat(2, 1fr); grid-auto-rows: 1fr; grid-auto-flow: dense; }
    .cmark { position: absolute; background: #000; }
    @media print {
      html, body { background: #fff !important; }
      /* Drop the site chrome entirely (no reserved space → no blank pages). */
      body > *:not(main) { display: none !important; }
      body > main { display: block !important; margin: 0 !important; padding: 0 !important; }
      .print-root { position: static !important; overflow: visible !important; background: #fff !important; padding: 0 !important; }
      .sheet { margin: 0 !important; box-shadow: none !important; }
      .no-print { display: none !important; }
    }
  `

  return (
    <div className="print-root">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <PrintToolbar backHref={`/admin/print/${editionId}/builder`} />

      {document.pages.map((page) => (
        <div key={page.id} className="sheet">
          <CropMarks />
          <div className="trim">
            <div className="pgrid" style={{ gridTemplateRows: `repeat(${densityRows(page.density)}, 1fr)` }}>
              {page.blocks.map((b) => (
                <div key={b.id} style={{ gridColumn: `span ${b.span.col}`, gridRow: `span ${b.span.row}`, minHeight: 0 }}>
                  <PrintAdBlock block={b} tierLabel={tierLabel(b.tier_key)} size={blockSize(page.density, b.span)} />
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Four corner crop marks drawn inside the 3mm bleed margin, at the trim corners. */
function CropMarks() {
  const v = { width: '0.2mm', height: `${BLEED}mm` }
  const h = { height: '0.2mm', width: `${BLEED}mm` }
  return (
    <>
      <div className="cmark" style={{ ...v, top: 0, left: `${BLEED}mm` }} />
      <div className="cmark" style={{ ...h, top: `${BLEED}mm`, left: 0 }} />
      <div className="cmark" style={{ ...v, top: 0, right: `${BLEED}mm` }} />
      <div className="cmark" style={{ ...h, top: `${BLEED}mm`, right: 0 }} />
      <div className="cmark" style={{ ...v, bottom: 0, left: `${BLEED}mm` }} />
      <div className="cmark" style={{ ...h, bottom: `${BLEED}mm`, left: 0 }} />
      <div className="cmark" style={{ ...v, bottom: 0, right: `${BLEED}mm` }} />
      <div className="cmark" style={{ ...h, bottom: `${BLEED}mm`, right: 0 }} />
    </>
  )
}
