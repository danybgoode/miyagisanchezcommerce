import { expect, test } from '@playwright/test'
import {
  detectPlatformFromSignals,
  estimateInventoryFromHtml,
  buildAnalyzerResult,
} from '../lib/shop-url-analyzer'
import { VERY_CUSTOM_LISTING_THRESHOLD } from '../lib/migration-parity'
import { COMPARADOR_PLATFORMS } from '../lib/cost-comparator-url'

// Comparador de costos (epic 08 · cost-comparator-homepage, Sprint 3 · US-3.1) —
// the shop-URL analyzer's PURE half, fixture-driven (no network, mirrors
// e2e/migrations-parity.spec.ts's fixture style). The SSRF-hardened fetch layer
// (lib/shop-url-analyzer-fetch.ts) is exercised at the HTTP level instead — see
// e2e/comparador-analyze-route.spec.ts — deliberately never with a real live
// fetch from CI (no flakiness, no cost, no accidental abuse of a third party).

const SHOPIFY_FIXTURE_HTML = `
<!doctype html><html><head>
<meta name="generator" content="Shopify">
<script src="https://cdn.shopify.com/s/files/1/0001/theme.js"></script>
</head><body>
<nav><a href="/collections/all">Todo</a><a href="/collections/nuevo">Nuevo</a><a href="/pages/about">Acerca</a></nav>
<script type="application/ld+json">{"@type":"Product","name":"Playera"}</script>
<script type="application/ld+json">{"@type":"Product","name":"Gorra"}</script>
<img src="/a.jpg"><img src="/b.jpg"><img src="/c.jpg">
<footer><a href="/pages/politicas">Políticas de privacidad</a></footer>
</body></html>`

const TIENDANUBE_FIXTURE_HTML = `
<!doctype html><html><head><title>Mi tienda — Tiendanube</title></head><body>
<nav><a href="/productos/">Productos</a></nav>
<a href="/productos/playera">Playera</a>
<a href="/productos/gorra">Gorra</a>
<img src="/x.jpg">
</body></html>`

const WOOCOMMERCE_FIXTURE_HTML = `
<!doctype html><html><head>
<meta name="generator" content="WooCommerce 8.0 - WordPress">
</head><body class="woocommerce">
<link rel="stylesheet" href="/wp-content/plugins/woocommerce/assets/style.css">
<nav><a href="/tienda/">Tienda</a></nav>
</body></html>`

const UNKNOWN_FIXTURE_HTML = `<!doctype html><html><head><title>Página personal</title></head><body>
<p>Hola, este es mi blog, no una tienda.</p>
</body></html>`

test.describe('shop-url-analyzer · detectPlatformFromSignals (pure)', () => {
  test('a *.myshopify.com hostname is detected as Shopify even with no other signal', () => {
    expect(detectPlatformFromSignals('<html></html>', 'algo.myshopify.com')).toBe('shopify')
  })

  test('Shopify CDN + generator meta in the HTML detects Shopify', () => {
    expect(detectPlatformFromSignals(SHOPIFY_FIXTURE_HTML, 'mitienda.com')).toBe('shopify')
  })

  test('Tiendanube signals detect tiendanube', () => {
    expect(detectPlatformFromSignals(TIENDANUBE_FIXTURE_HTML, 'mitienda.com')).toBe('tiendanube')
  })

  test('WooCommerce signals detect woocommerce', () => {
    expect(detectPlatformFromSignals(WOOCOMMERCE_FIXTURE_HTML, 'mitienda.com')).toBe('woocommerce')
  })

  test('a Mercado Libre hostname detects mercadolibre', () => {
    expect(detectPlatformFromSignals('<html></html>', 'articulo.mercadolibre.com.mx')).toBe('mercadolibre')
  })

  test('no signal at all → null, never a fabricated guess', () => {
    expect(detectPlatformFromSignals(UNKNOWN_FIXTURE_HTML, 'blog-personal.com')).toBeNull()
  })

  test('every non-null detection is a real CompetitorPlatform the calculator accepts', () => {
    const detections = [
      detectPlatformFromSignals(SHOPIFY_FIXTURE_HTML, 'mitienda.com'),
      detectPlatformFromSignals(TIENDANUBE_FIXTURE_HTML, 'mitienda.com'),
      detectPlatformFromSignals(WOOCOMMERCE_FIXTURE_HTML, 'mitienda.com'),
    ]
    for (const d of detections) {
      expect(d).not.toBeNull()
      expect(COMPARADOR_PLATFORMS).toContain(d)
    }
  })
})

test.describe('shop-url-analyzer · estimateInventoryFromHtml (pure)', () => {
  test('counts JSON-LD Product entries, nav anchors, images, and a policies link', () => {
    const inv = estimateInventoryFromHtml(SHOPIFY_FIXTURE_HTML)
    expect(inv.catalogCount).toBe(2)
    expect(inv.sectionCount).toBe(3)
    expect(inv.imageCount).toBe(3)
    expect(inv.hasPolicies).toBe(true)
  })

  test('falls back to counting /productos/ links when there is no JSON-LD', () => {
    const inv = estimateInventoryFromHtml(TIENDANUBE_FIXTURE_HTML)
    expect(inv.catalogCount).toBe(2)
  })

  test('empty/junk HTML degrades to all zeros, never throws', () => {
    const inv = estimateInventoryFromHtml('')
    expect(inv).toEqual({ catalogCount: 0, sectionCount: 0, imageCount: 0, hasPolicies: false })
  })

  test('no policies link found → false, not a false positive', () => {
    const inv = estimateInventoryFromHtml(WOOCOMMERCE_FIXTURE_HTML)
    expect(inv.hasPolicies).toBe(false)
  })
})

test.describe('shop-url-analyzer · buildAnalyzerResult (pure) — the fixture-URL spec sprint-3.md requires', () => {
  test('a fixture Shopify shop URL: platform detected, prefillable, parity table attached', () => {
    const result = buildAnalyzerResult({
      url: 'https://demo-shop.myshopify.com/',
      html: SHOPIFY_FIXTURE_HTML,
      truncated: false,
    })
    expect(result.platform).toBe('shopify')
    // Prefill contract: whatever the analyzer returns must be directly assignable
    // to the calculator's platform state (ComparadorTool's setPlatform call) —
    // proven by round-tripping through the same allow-list the URL codec uses.
    expect(COMPARADOR_PLATFORMS).toContain(result.platform)
    expect(result.inventory.catalogCount).toBe(2)
    expect(result.parity).not.toBeNull()
    expect(result.parity?.sections.map((s) => s.key)).toEqual([
      'announcement', 'hero', 'theme', 'collections', 'content_pages',
    ])
    expect(result.parity?.veryCustom).toBe(false)
  })

  test('a truncated Shopify fetch surfaces very-custom via the shared module, unmodified', () => {
    const result = buildAnalyzerResult({
      url: 'https://demo-shop.myshopify.com/',
      html: SHOPIFY_FIXTURE_HTML,
      truncated: true,
    })
    expect(result.truncated).toBe(true)
    expect(result.parity?.veryCustom).toBe(true)
    expect(result.parity?.veryCustomReason).toMatch(/catálogo/i)
  })

  test('a huge Shopify catalog count is NOT auto-flagged very-custom (mirrors migration-parity Sprint 2 semantics)', () => {
    const result = buildAnalyzerResult({
      url: 'https://demo-shop.myshopify.com/',
      html: SHOPIFY_FIXTURE_HTML.replace(
        '<img src="/a.jpg">',
        Array.from({ length: VERY_CUSTOM_LISTING_THRESHOLD }, (_, i) => `<script type="application/ld+json">{"@type":"Product","name":"P${i}"}</script>`).join(''),
      ),
      truncated: false,
    })
    expect(result.parity?.veryCustom).toBe(false)
  })

  test('a detected non-Shopify platform gets NO parity table — never misattribute Shopify-specific notes', () => {
    const woo = buildAnalyzerResult({ url: 'https://mitienda.com/', html: WOOCOMMERCE_FIXTURE_HTML, truncated: false })
    expect(woo.platform).toBe('woocommerce')
    expect(woo.parity).toBeNull()

    const tn = buildAnalyzerResult({ url: 'https://mitienda.com/', html: TIENDANUBE_FIXTURE_HTML, truncated: false })
    expect(tn.platform).toBe('tiendanube')
    expect(tn.parity).toBeNull()
  })

  test('an unrecognized shop degrades to platform: null, inventory still computed — manual entry stays the fallback', () => {
    const result = buildAnalyzerResult({ url: 'https://blog-personal.com/', html: UNKNOWN_FIXTURE_HTML, truncated: false })
    expect(result.platform).toBeNull()
    expect(result.parity).toBeNull()
    expect(result.inventory.catalogCount).toBe(0)
  })

  test('a malformed url string never throws — hostname just falls back to empty (no crash on the pure builder)', () => {
    expect(() => buildAnalyzerResult({ url: 'not a url', html: SHOPIFY_FIXTURE_HTML, truncated: false })).not.toThrow()
  })
})
