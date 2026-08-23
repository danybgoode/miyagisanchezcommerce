import { brotliCompressSync } from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'

// D16: these are the actual S3 buyer entrypoints after the S2 public-read
// split. A whole `.next/static` total is not a route budget.
export const BUYER_ROUTE_MANIFESTS = {
  '/mx': '(mx-site)/mx/page_client-reference-manifest.js',
  '/mx/l/[id]': 'listing/[id]/page_client-reference-manifest.js',
  '/mx/s/[slug]': 'shop/[[...rest]]/page_client-reference-manifest.js',
}

export const FORBIDDEN_BUYER_VENDORS = ['xlsx', 'jszip', 'mercadopago', '@dnd-kit']

// Turbopack's client-reference manifest names application modules and chunk
// files, not every transitive package in those chunks. These exported symbols
// survive minification and identify the actual vendor payload, so checking the
// resolved chunk graph catches a transitive import the manifest text cannot.
const FORBIDDEN_BUYER_VENDOR_MARKERS = {
  xlsx: [/\bsheet_to_json\b/, /\bbook_new\b/],
  jszip: [/\bJSZip\b/],
  // Product copy and colour-token names mention Mercado Pago on public
  // pages. Its server SDK is identified by these exported constructor names,
  // not by a human-readable payment label.
  mercadopago: [/\bMercadoPagoConfig\b/, /\bPreApprovalPlan\b/],
  '@dnd-kit': [/\bDndContext\b/, /\buseDndMonitor\b/],
}

export function parseClientReferenceManifest(source) {
  const match = source.match(/=\s*(\{[\s\S]*\});\s*$/)
  if (!match) throw new Error('UNAVAILABLE — client-reference manifest has an unrecognised shape')
  return JSON.parse(match[1])
}

export function collectManifestChunks(manifest) {
  const chunks = new Set()
  for (const clientModule of Object.values(manifest.clientModules ?? {})) {
    for (const chunk of clientModule.chunks ?? []) chunks.add(chunk.replace(/^\/_next\//, ''))
  }
  for (const files of Object.values(manifest.entryJSFiles ?? {})) {
    for (const file of files) chunks.add(file)
  }
  return [...chunks].filter((chunk) => chunk.startsWith('static/chunks/') && chunk.endsWith('.js')).sort()
}

export function reportRouteManifest({ manifestSource, readChunk }) {
  const manifest = parseClientReferenceManifest(manifestSource)
  const chunks = collectManifestChunks(manifest)
  if (!chunks.length) throw new Error('UNAVAILABLE — route manifest contains no client JS chunks')
  const chunkBytes = chunks.map((chunk) => {
    const content = Buffer.from(readChunk(chunk))
    return {
      chunk,
      bytes: brotliCompressSync(content).byteLength,
      source: content.toString('utf8'),
    }
  })
  return {
    chunks: chunkBytes,
    brotliBytes: chunkBytes.reduce((total, entry) => total + entry.bytes, 0),
    manifestSource,
  }
}

export function findForbiddenBuyerVendors(report) {
  const source = report.chunks.map((chunk) => chunk.source).join('\n')
  return FORBIDDEN_BUYER_VENDORS.filter((vendor) =>
    FORBIDDEN_BUYER_VENDOR_MARKERS[vendor].some((marker) => marker.test(source)),
  )
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(candidate) : [candidate]
  })
}

export function findRouteManifest(root, suffix) {
  const appRoot = path.join(root, '.next', 'server', 'app')
  if (!fs.existsSync(appRoot)) throw new Error(`UNAVAILABLE — build manifest directory missing: ${appRoot}`)
  const matches = walk(appRoot).filter((file) => file.endsWith(suffix))
  if (matches.length !== 1) throw new Error(`UNAVAILABLE — expected one route manifest for ${suffix}, found ${matches.length}`)
  return matches[0]
}

export function readBuyerRouteReports(root = process.cwd()) {
  return Object.fromEntries(Object.entries(BUYER_ROUTE_MANIFESTS).map(([route, suffix]) => {
    const manifestPath = findRouteManifest(root, suffix)
    const manifestSource = fs.readFileSync(manifestPath, 'utf8')
    return [route, reportRouteManifest({
      manifestSource,
      readChunk: (chunk) => {
        const chunkPath = path.join(root, '.next', chunk)
        if (!fs.existsSync(chunkPath)) throw new Error(`UNAVAILABLE — manifest chunk missing: ${chunkPath}`)
        return fs.readFileSync(chunkPath)
      },
    })]
  }))
}
