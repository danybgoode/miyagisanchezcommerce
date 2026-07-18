/**
 * lib/smalldocs.ts
 *
 * Comparador de costos (epic 08 · cost-comparator-homepage, Sprint 2 · US-2.1) —
 * client-side codec that turns a markdown string into a smalldocs.org URL. Entirely
 * client-side by design (the epic README's v1 export contract): the document never
 * touches our server, it travels compressed in the URL hash fragment, exactly like
 * smalldocs' own "your document lives in the URL hash — browsers never send it to
 * the server" model (github.com/espressoplease/smalldocs README, 2026-07-17).
 *
 * ENCODING DECISION — deflate, not brotli:
 * smalldocs' own browser code (`public/sdocs-app.js`, `compressText`/`decompressText`)
 * compresses with a bundled brotli WASM (`BrotliWasm.compress`) but explicitly FALLS
 * BACK to `CompressionStream('deflate-raw')` + base64url whenever brotli is
 * unavailable — and `decompressText` tries brotli first, then unconditionally falls
 * back to the SAME deflate decoder for "old URLs or missing WASM". That fallback is
 * a real, maintained code path in smalldocs, not a guess. Rather than bundle their
 * ~1MB brotli WASM into this app for a v1 "open a report" button, we produce a
 * `#md=` hash using ONLY that documented deflate fallback — smalldocs opens it
 * exactly like any other URL where brotli decompression came back empty. Base64url
 * alphabet and the `#md=<b64>&mode=read` hash shape are copied verbatim from
 * smalldocs' `toBase64Url`/`fromBase64Url` and `CLI.md`'s documented URL shape.
 *
 * `CompressionStream`/`DecompressionStream` are supported in every browser Miyagi
 * targets (Chrome/Edge 80+, Safari 16.4+, Firefox 113+) — no polyfill needed.
 */

const SMALLDOCS_BASE_URL = 'https://smalldocs.org'

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function readAllChunks(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = readable.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const buf = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    buf.set(c, offset)
    offset += c.length
  }
  return buf
}

async function compressDeflate(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text)
  const cs = new CompressionStream('deflate-raw')
  const writer = cs.writable.getWriter()
  writer.write(encoded)
  writer.close()
  return toBase64Url(await readAllChunks(cs.readable))
}

async function decompressDeflate(bytes: Uint8Array): Promise<string> {
  const ds = new DecompressionStream('deflate-raw')
  const writer = ds.writable.getWriter()
  // Cast needed under TS 5.9's stricter BufferSource typing (Uint8Array<ArrayBufferLike>
  // vs. the DOM lib's Uint8Array<ArrayBuffer>) — the bytes themselves are a plain
  // Uint8Array either way, this is purely a type-level friction point.
  writer.write(bytes as unknown as BufferSource)
  writer.close()
  return new TextDecoder().decode(await readAllChunks(ds.readable))
}

/** Compress `markdown` and return the full smalldocs.org URL — never sends the
 * document anywhere; the hash fragment stays client-side by browser design. */
export async function buildSmalldocsUrl(markdown: string): Promise<string> {
  const compressed = await compressDeflate(markdown)
  return `${SMALLDOCS_BASE_URL}/#md=${compressed}&mode=read`
}

/** Inverse of `buildSmalldocsUrl`'s compression step — round-trip proof for the
 * unit spec (smalldocs itself decodes this the same way; this is not the render). */
export async function decodeSmalldocsHash(hash: string): Promise<string> {
  const match = /[#&]md=([^&]+)/.exec(hash)
  if (!match) throw new Error('No md= parameter in hash')
  return decompressDeflate(fromBase64Url(match[1]))
}
