/**
 * Per-edition production export pack (Option A — designer-in-the-loop).
 *
 * Bundles every APPROVED ad submission into a ZIP Miyagi opens to lay the
 * magazine out by hand: per-ad copy + hi-res photos + logo + generated QR, plus
 * a top-level print spec (the provider's file_spec) and a printable contact sheet.
 */

import JSZip from 'jszip'
import { db } from '@/lib/supabase'
import { ensureSubmissionQr } from '@/lib/print-qr'
import type { PrintEdition, PrintAdSubmission, PrintFileSpec, PrintTier } from '@/lib/print'

function extFromUrl(url: string, fallback = 'jpg'): string {
  const m = url.split('?')[0].match(/\.([a-z0-9]{2,5})$/i)
  return (m?.[1] ?? fallback).toLowerCase()
}

function slug(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
}

async function fetchBytes(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.arrayBuffer()
  } catch {
    return null
  }
}

function specSheet(
  edition: PrintEdition,
  providerName: string,
  fileSpec: PrintFileSpec,
  ads: Array<{ folder: string; tier: string; advertiser: string; cta: string }>,
): string {
  const lines = [
    `EDICIÓN: ${edition.title}`,
    `Imprenta: ${providerName}`,
    edition.submission_deadline ? `Cierre: ${edition.submission_deadline}` : '',
    edition.distribution_date ? `Distribución: ${edition.distribution_date}` : '',
    (edition.coverage_zones ?? []).length ? `Zonas: ${edition.coverage_zones.join(', ')}` : '',
    '',
    '── ESPECIFICACIÓN DE IMPRESIÓN ──',
    `Tamaño:       ${fileSpec.trim_size ?? '—'}`,
    `Sangrado:     ${fileSpec.bleed_mm ?? '—'} mm`,
    `Resolución:   ${fileSpec.dpi ?? '—'} DPI`,
    `Color:        ${fileSpec.color_mode ?? '—'}`,
    `Estándar PDF: ${fileSpec.pdf_standard ?? '—'}`,
    `Fuentes:      ${fileSpec.fonts ?? '—'}`,
    `Límite tinta: ${fileSpec.ink_limit ?? '—'}%`,
    '',
    `── ANUNCIOS APROBADOS (${ads.length}) ──`,
    ...ads.map((a, i) => `${String(i + 1).padStart(2, '0')}. [${a.tier}] ${a.advertiser} — ${a.cta}  → ${a.folder}/`),
    '',
    'Genera el PDF final en CMYK con sangrado y marcas de corte. Las imágenes y QR de este paquete están en alta resolución.',
  ]
  return lines.filter((l) => l !== '').join('\n')
}

function contactSheet(
  edition: PrintEdition,
  cards: Array<{ folder: string; tier: string; advertiser: string; headline: string; body: string; photo: string | null; qr: string | null; cta: string }>,
): string {
  const esc = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${esc(edition.title)} — hoja de contactos</title>
<style>
 body{font-family:Georgia,'Times New Roman',serif;background:#f4efe6;color:#1a1a18;margin:0;padding:24px}
 h1{font-family:Arial Black,Impact,sans-serif;text-transform:uppercase;letter-spacing:1px;color:#0a4d2e}
 .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
 .ad{border:3px solid #0a4d2e;background:#fff;padding:12px;display:flex;gap:12px}
 .ad img.photo{width:120px;height:120px;object-fit:cover;border:1px solid #ccc}
 .ad .qr{width:72px;height:72px}
 .ad h2{margin:0 0 4px;font-family:Arial Black,Impact,sans-serif;text-transform:uppercase;font-size:18px}
 .tier{font-size:11px;color:#a33;text-transform:uppercase;letter-spacing:1px}
 .meta{font-size:12px;color:#555}
</style></head><body>
<h1>${esc(edition.title)}</h1>
<p class="meta">Hoja de contactos · ${cards.length} anuncios aprobados · referencia de maquetación</p>
<div class="grid">
${cards.map((c) => `  <div class="ad">
    ${c.photo ? `<img class="photo" src="${c.folder}/${c.photo}" alt="">` : ''}
    <div>
      <div class="tier">${esc(c.tier)}</div>
      <h2>${esc(c.headline || '(sin titular)')}</h2>
      <div class="meta">${esc(c.body)}</div>
      <div class="meta">${esc(c.advertiser)} · ${esc(c.cta)}</div>
      ${c.qr ? `<img class="qr" src="${c.folder}/${c.qr}" alt="QR">` : ''}
    </div>
  </div>`).join('\n')}
</div></body></html>`
}

export interface ExportResult { filename: string; buffer: Buffer; adCount: number }

/**
 * Build the production ZIP for an edition. Returns null if the edition is missing.
 * Note: assembled in-memory — fine for a small local edition; stage via R2 if editions grow large.
 */
export async function buildEditionExportZip(editionId: string): Promise<ExportResult | null> {
  const { data: edition } = await db
    .from('print_editions')
    .select('*, print_providers(name, file_spec)')
    .eq('id', editionId)
    .single() as { data: (PrintEdition & { print_providers?: { name?: string; file_spec?: PrintFileSpec } | null }) | null }
  if (!edition) return null

  const providerName = edition.print_providers?.name ?? 'Miyagi Prints'
  const fileSpec = edition.print_providers?.file_spec ?? {}
  const tierLabel = (key: string) => (edition.tiers ?? []).find((t: PrintTier) => t.key === key)?.label ?? key

  const { data: subsRaw } = await db
    .from('print_ad_submissions')
    .select('*')
    .eq('edition_id', editionId)
    .eq('status', 'approved')
    .order('created_at', { ascending: true })
  const subs = (subsRaw ?? []) as PrintAdSubmission[]

  const zip = new JSZip()
  const indexEntries: Array<{ folder: string; tier: string; advertiser: string; cta: string }> = []
  const cardEntries: Array<{ folder: string; tier: string; advertiser: string; headline: string; body: string; photo: string | null; qr: string | null; cta: string }> = []

  let i = 0
  for (const sub of subs) {
    i++
    await ensureSubmissionQr(sub, edition) // refresh content.qr_url if needed
    const { data: fresh } = await db.from('print_ad_submissions').select('content').eq('id', sub.id).single()
    const content = (fresh?.content ?? sub.content ?? {}) as PrintAdSubmission['content']

    const advertiser = sub.buyer_email ?? sub.seller_id
    const tier = tierLabel(sub.tier_key)
    const cta = content.cta_target?.url ?? ''
    const folder = `ads/${String(i).padStart(2, '0')}-${slug(tier)}`
    const dir = zip.folder(folder)!

    const copy = [
      `Anunciante: ${advertiser}`,
      `Tamaño: ${tier}`,
      '',
      `Titular: ${content.headline ?? ''}`,
      `Subtítulo: ${content.subhead ?? ''}`,
      '',
      `Descripción:`,
      content.body ?? '',
      '',
      `WhatsApp: ${content.contact?.whatsapp_seller ?? ''}`,
      `Teléfono: ${content.contact?.phone ?? ''}`,
      `Enlace (QR): ${cta}`,
    ].join('\n')
    dir.file('copy.txt', copy)

    // Logo
    if (content.logo_url) {
      const bytes = await fetchBytes(content.logo_url)
      if (bytes) dir.file(`logo.${extFromUrl(content.logo_url, 'png')}`, bytes)
    }
    // Photos
    let firstPhoto: string | null = null
    const photos = content.photos ?? []
    for (let p = 0; p < photos.length; p++) {
      const bytes = await fetchBytes(photos[p])
      if (bytes) {
        const name = `photo-${p + 1}.${extFromUrl(photos[p])}`
        dir.file(name, bytes)
        if (!firstPhoto) firstPhoto = name
      }
    }
    // QR
    let qrName: string | null = null
    if (content.qr_url) {
      const bytes = await fetchBytes(content.qr_url)
      if (bytes) { qrName = 'qr.png'; dir.file(qrName, bytes) }
    }

    indexEntries.push({ folder, tier, advertiser, cta })
    cardEntries.push({
      folder, tier, advertiser, cta,
      headline: content.headline ?? '',
      body: content.body ?? '',
      photo: firstPhoto, qr: qrName,
    })
  }

  zip.file('spec.txt', specSheet(edition, providerName, fileSpec, indexEntries))
  zip.file('index.html', contactSheet(edition, cardEntries))

  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  const filename = `${slug(edition.title) || 'edicion'}-paquete.zip`
  return { filename, buffer, adCount: subs.length }
}
