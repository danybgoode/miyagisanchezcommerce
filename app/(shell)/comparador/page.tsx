import type { Metadata } from 'next'
import { getComparatorDataset } from '@/lib/cost-comparator-data'
import {
  shopifyRatesFromDataset,
  mercadoLibreRatesFromDataset,
  wooCommerceRatesFromDataset,
  tiendanubeRatesFromDataset,
  miyagiRatesFromDataset,
  premiumAppsFromDataset,
  fxUsdToMxnFromDataset,
} from '@/lib/cost-comparator-dataset'
import type {
  ShopifyTier,
  MlBand,
  MlPublicationType,
  WooCommerceHostingTier,
  TiendanubeTier,
} from '@/lib/cost-comparator'
import ComparadorTool, { type CompetitorPlatform, type ComparadorInitial } from './_components/ComparadorTool'
import ComparadorAnalytics from './_components/ComparadorAnalytics'

const BASE_URL = 'https://miyagisanchez.com'
const PAGE_PATH = '/comparador'

const TITLE = 'Comparador de costos — Miyagi Sánchez vs. Shopify, Mercado Libre, WooCommerce y Tiendanube'
const DESCRIPTION =
  'Compara lo que pagas hoy en Shopify, Mercado Libre, WooCommerce o Tiendanube contra Miyagi Sánchez (0% comisión) — con tus propios números de ventas.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${BASE_URL}${PAGE_PATH}` },
  openGraph: {
    type: 'website',
    locale: 'es_MX',
    url: `${BASE_URL}${PAGE_PATH}`,
    siteName: 'Miyagi Sánchez',
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
}

type ComparadorPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

function toNumber(v: string | string[] | undefined, fallback: number): number {
  const raw = first(v)
  if (raw === undefined) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

const PLATFORMS: CompetitorPlatform[] = ['shopify', 'mercadolibre', 'woocommerce', 'tiendanube']
const SHOPIFY_TIERS: ShopifyTier[] = ['basico', 'crecimiento', 'avanzado']
const ML_BANDS: MlBand[] = ['baja', 'media', 'alta']
const ML_TYPES: MlPublicationType[] = ['clasica', 'premium']
const WOO_TIERS: WooCommerceHostingTier[] = ['entrada', 'crecimiento']
const TN_TIERS: TiendanubeTier[] = ['gratis', 'basico', 'tiendanube', 'avanzado']

function pick<T extends string>(v: string | string[] | undefined, allowed: T[], fallback: T): T {
  const raw = first(v)
  return (allowed as string[]).includes(raw ?? '') ? (raw as T) : fallback
}

function formatVerifiedDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${iso}T00:00:00`))
  } catch {
    return iso
  }
}

/**
 * Comparador de costos (epic 08 · cost-comparator-homepage, Sprint 1 · US-1.3) —
 * an anonymous, mobile-first calculator. Reads `searchParams` (query-string
 * prefill: `?platform=shopify&tier=basico&volume=100&aov=500`) so a linked-to
 * comparison renders its exact numbers in the initial server HTML — no client
 * JS required to see the right totals (the `e2e/comparador.spec.ts` `api`
 * project spec depends on this: it's a raw HTTP GET, no browser).
 *
 * `/` (the homepage) stays static — this route is intentionally NOT under the
 * `(site)` group, so reading `searchParams` here can't taint the homepage's
 * prerender (see `e2e/home-static.spec.ts` / `home-comparador-teaser.spec.ts`).
 */
export default async function ComparadorPage({ searchParams }: ComparadorPageProps) {
  const sp = await searchParams
  const dataset = await getComparatorDataset('es')

  const rates = {
    shopify: shopifyRatesFromDataset(dataset),
    mercadolibre: mercadoLibreRatesFromDataset(dataset),
    woocommerce: wooCommerceRatesFromDataset(dataset),
    tiendanube: tiendanubeRatesFromDataset(dataset),
    miyagi: miyagiRatesFromDataset(dataset),
  }
  const apps = premiumAppsFromDataset(dataset)
  const fx = fxUsdToMxnFromDataset(dataset)

  const initial: ComparadorInitial = {
    platform: pick(sp.platform, PLATFORMS, 'shopify'),
    shopifyTier: pick(sp.tier, SHOPIFY_TIERS, 'basico'),
    mlBand: pick(sp.band, ML_BANDS, 'media'),
    mlPublicationType: pick(sp.type, ML_TYPES, 'clasica'),
    wooTier: pick(sp.hosting, WOO_TIERS, 'entrada'),
    tnTier: pick(sp.tier, TN_TIERS, 'basico'),
    tnOwnGateway: first(sp.gateway) !== 'external',
    volume: toNumber(sp.volume, 100),
    aov: toNumber(sp.aov, 500),
  }

  return (
    <div className="app-shell" style={{ paddingTop: 'var(--s-8)', paddingBottom: 'var(--s-10)', maxWidth: 720, margin: '0 auto', paddingLeft: 'var(--s-4)', paddingRight: 'var(--s-4)' }}>
      <ComparadorAnalytics />
      <div style={{ marginBottom: 'var(--s-6)' }}>
        <h1 className="t-h1" style={{ letterSpacing: 0, marginBottom: 'var(--s-2)', fontSize: 'clamp(var(--t-xl), 6vw, var(--t-3xl))' }}>
          Compara lo que pagas hoy contra Miyagi
        </h1>
        <p className="t-lead" style={{ color: 'var(--fg-muted)', marginBottom: 'var(--s-3)' }}>
          Con tus propios números — plataforma, volumen, ticket promedio y las apps que ya pagas.
        </p>
        <span className="badge badge-verified" data-testid="comparador-verified-date">
          Datos verificados: {formatVerifiedDate(dataset.generatedAt)}
        </span>
      </div>

      <ComparadorTool rates={rates} apps={apps} fx={fx} initial={initial} />

      <p className="t-caption" style={{ color: 'var(--fg-muted)', marginTop: 'var(--s-6)' }}>
        Comparación de referencia con tarifas públicas de cada plataforma — cada cifra es editable y muestra
        su fuente al pasar el cursor. Las tarifas cambian: pídele a tu IA que las confirme antes de decidir.
      </p>
    </div>
  )
}
