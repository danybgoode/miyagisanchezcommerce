/**
 * QR generation for print-ad placements. Each ad's CTA (a /l/[id] or /s/[slug]
 * URL) becomes a high-error-correction QR PNG with UTM tags, stored in R2 so it
 * can be dropped straight into the printed layout. The UTM tags surface in GA4 /
 * Clarity, which run site-wide via the single GTM container (`<SiteAnalytics>`).
 */

import QRCode from 'qrcode'
import { db } from '@/lib/supabase'
import { uploadToR2 } from '@/lib/r2'
import type { PrintAdSubmission, PrintEdition } from '@/lib/print'
import type { PrintLayoutDocument } from '@/lib/print-layout'

/**
 * Append print-edition UTM params to a CTA URL (preserving any existing query),
 * so scans are attributable in the site-wide analytics (GA4 / Clarity via GTM).
 */
export function buildQrTargetUrl(ctaUrl: string, editionId: string): string {
  try {
    const u = new URL(ctaUrl)
    u.searchParams.set('utm_source', 'edicion-impresa')
    u.searchParams.set('utm_medium', 'qr')
    u.searchParams.set('utm_campaign', editionId)
    return u.toString()
  } catch {
    return ctaUrl
  }
}

/** Render a QR code as a PNG buffer sized + margined for print (300+ DPI friendly). */
export async function generateQrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    errorCorrectionLevel: 'H', // survives ink spread / small reproduction
    type: 'png',
    margin: 2,                 // quiet zone
    scale: 12,                 // ~1200px — plenty for a small printed QR at 300dpi
    color: { dark: '#000000ff', light: '#ffffffff' },
  })
}

/**
 * Ensure a submission has a generated QR stored in R2, returning its URL.
 * Idempotent — returns the existing `content.qr_url` if already generated.
 */
export async function ensureSubmissionQr(
  submission: PrintAdSubmission,
  edition: Pick<PrintEdition, 'id'>,
): Promise<string | null> {
  const content = submission.content ?? {}
  if (content.qr_url) return content.qr_url

  const ctaUrl = content.cta_target?.url
  if (!ctaUrl) return null

  const target = buildQrTargetUrl(ctaUrl, edition.id)
  const png = await generateQrPng(target)
  // Buffer is a Uint8Array view; hand uploadToR2 a clean ArrayBuffer slice.
  const ab = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer

  let qrUrl: string
  try {
    qrUrl = await uploadToR2(ab, `print/qr/${submission.id}.png`, 'image/png')
  } catch (e) {
    console.error('[print-qr] upload failed:', e)
    return null
  }

  await db
    .from('print_ad_submissions')
    .update({ content: { ...content, qr_url: qrUrl } })
    .eq('id', submission.id)

  return qrUrl
}

/**
 * Ensure every block with a CTA has a generated QR in its content, generating any
 * that are missing (deterministic R2 key per block). Mutates `document` in place and
 * returns whether anything changed (so the caller can persist when not locked). Used
 * by the print view so catalog/house-ad blocks and paid blocks alike show real QRs.
 */
export async function ensureLayoutQrs(
  editionId: string,
  document: PrintLayoutDocument,
): Promise<{ document: PrintLayoutDocument; changed: boolean }> {
  let changed = false
  for (const page of document.pages ?? []) {
    for (const block of page.blocks ?? []) {
      const url = block.content?.cta_target?.url
      if (!url || block.content.qr_url) continue
      try {
        const png = await generateQrPng(buildQrTargetUrl(url, editionId))
        const ab = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer
        block.content.qr_url = await uploadToR2(ab, `print/qr/block/${block.id}.png`, 'image/png')
        changed = true
      } catch (e) {
        console.error('[print-qr] block QR failed:', e)
      }
    }
  }
  return { document, changed }
}
