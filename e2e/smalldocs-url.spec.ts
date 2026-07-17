import { expect, test } from '@playwright/test'
import { buildSmalldocsUrl, decodeSmalldocsHash } from '../lib/smalldocs'

/**
 * Comparador de costos (epic 08 · cost-comparator-homepage, Sprint 2 · US-2.1) —
 * proves the smalldocs encoding DECISION actually round-trips: `CompressionStream
 * ('deflate-raw')` + base64url into `#md=...&mode=read`, decoded back with the
 * matching `DecompressionStream`. This is the documented FALLBACK path smalldocs'
 * own browser code takes when brotli WASM isn't available (see lib/smalldocs.ts's
 * header) — this spec proves OUR encoder/decoder pair is internally consistent,
 * not that smalldocs.org itself accepts it (that's Daniel's phone smoke,
 * sprint-2.md walkthrough step 2 — an external site an automated spec can't own).
 *
 * Runs under Node (Playwright's `api` project), which has `CompressionStream`/
 * `DecompressionStream` natively since Node 18 — same Web Streams API surface a
 * browser exposes, so this is a faithful proof of the browser code path.
 */

test.describe('smalldocs · URL encoding round-trips', () => {
  test('buildSmalldocsUrl produces the documented #md=...&mode=read shape', async () => {
    const url = await buildSmalldocsUrl('# Hola\n\nUn reporte de prueba.')
    expect(url).toMatch(/^https:\/\/smalldocs\.org\/#md=[A-Za-z0-9_-]+&mode=read$/)
  })

  test('decodeSmalldocsHash inverts buildSmalldocsUrl exactly, byte for byte', async () => {
    const markdown = '# Comparador de costos\n\nLínea con acentos: ó, ñ, á — y un guión largo —.'
    const url = await buildSmalldocsUrl(markdown)
    const hash = url.slice(url.indexOf('#'))
    const decoded = await decodeSmalldocsHash(hash)
    expect(decoded).toBe(markdown)
  })

  test('a chart-fenced markdown report round-trips without corrupting the JSON payload', async () => {
    const markdown = '```chart\n{"type":"bar","labels":["A","B"],"values":[1,2],"format":"currency"}\n```'
    const url = await buildSmalldocsUrl(markdown)
    const decoded = await decodeSmalldocsHash(url.slice(url.indexOf('#')))
    expect(decoded).toBe(markdown)
    expect(() => JSON.parse(decoded.split('\n')[1])).not.toThrow()
  })
})
