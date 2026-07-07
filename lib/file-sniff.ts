/**
 * Real magic-byte format sniffing for buyer artwork uploads — none of the
 * existing upload routes in this codebase do this (they all trust the
 * client-declared Content-Type/extension), but a fully public, unauthenticated
 * upload surface (custom-print-products Sprint 3 Story 3.2) needs to verify
 * the actual bytes, not what the client claims they are.
 *
 * AI: modern Illustrator files are valid PDF containers by default (Adobe
 * saves a PDF-compatible body), so an `.ai` upload sniffs as 'pdf' — that's
 * expected, not a bug. Cross-checking 'ai' against a 'pdf' sniff result is
 * the caller's job (the allowlist-check layer), not this pure byte→format
 * mapper's.
 */

export type SniffedFormat = 'png' | 'jpg' | 'pdf' | 'svg' | null

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]
const JPEG_MAGIC = [0xff, 0xd8, 0xff]
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] // %PDF

function hasPrefix(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false
  }
  return true
}

/**
 * SVG has no fixed magic number (it's XML text, possibly preceded by a BOM,
 * an `<?xml ...?>` prolog, a DOCTYPE, or metadata comments from an export
 * tool) — search the first ~2KB case-insensitively for a `<svg` tag. Reject
 * outright if a `<script` tag or an `on*=` event-handler attribute also
 * appears in that prefix (cheap defense-in-depth; full SVG sanitization is
 * out of scope here — this app only ever renders an uploaded SVG as an
 * `<img src>`/download link, never `dangerouslySetInnerHTML`, so the residual
 * risk of an unsanitized SVG is low, but documented).
 */
function sniffSvg(bytes: Uint8Array): boolean {
  const prefixLen = Math.min(bytes.length, 2048)
  const text = Buffer.from(bytes.slice(0, prefixLen)).toString('utf-8').toLowerCase()
  if (!text.includes('<svg')) return false
  if (text.includes('<script') || /\son\w+\s*=/.test(text)) return false
  return true
}

export function sniffFileFormat(bytes: Uint8Array): SniffedFormat {
  if (hasPrefix(bytes, PNG_MAGIC)) return 'png'
  if (hasPrefix(bytes, JPEG_MAGIC)) return 'jpg'
  if (hasPrefix(bytes, PDF_MAGIC)) return 'pdf'
  if (sniffSvg(bytes)) return 'svg'
  return null
}
