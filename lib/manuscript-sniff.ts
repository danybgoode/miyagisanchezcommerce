/**
 * Manuscript magic-byte sniffing for the public bookshop-launchpad submission
 * upload (bookshop-launchpad S1.1) — a fully public, unauthenticated upload
 * surface, so the actual bytes are verified, never the client-declared
 * Content-Type/extension (same discipline as `lib/file-sniff.ts` for artwork).
 *
 * Depth = container magic + extension (the deliberate choice, 2026-07-07):
 *   - PDF has a clean magic number (`%PDF`).
 *   - EPUB and DOCX are BOTH ZIP containers (`PK\x03\x04`), so the magic alone
 *     can't tell them apart — the extension disambiguates the two. We do NOT
 *     crack the ZIP central directory open (that was the rejected deeper option).
 *
 * The pairing is strict: the container magic AND the extension must agree, so a
 * renamed `.exe`/`.jpg` (wrong magic) and a PDF renamed `.docx` (magic/ext
 * mismatch) are both rejected. Pure + next-free so the `api` runner unit-tests it.
 */
import type { ManuscriptFormat } from '@/lib/launchpad-types'

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] // %PDF
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] // PK\x03\x04 — first local file header

function hasPrefix(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false
  }
  return true
}

/** Lower-cased final extension (no dot), or '' if none. */
export function fileExtension(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

/**
 * Returns the manuscript format iff the leading magic bytes AND the filename
 * extension agree; otherwise `null` (unknown / spoofed / mismatched).
 */
export function sniffManuscript(bytes: Uint8Array, filename: string): ManuscriptFormat | null {
  const ext = fileExtension(filename)

  if (hasPrefix(bytes, PDF_MAGIC)) {
    return ext === 'pdf' ? 'pdf' : null
  }
  if (hasPrefix(bytes, ZIP_MAGIC)) {
    if (ext === 'epub') return 'epub'
    if (ext === 'docx') return 'docx'
    return null
  }
  return null
}
