/**
 * lib/cost-comparator-url.ts
 *
 * Comparador de costos (epic 08 · cost-comparator-homepage, Sprint 2 · US-2.2) — the
 * PURE URL ⇄ state codec for the comparator's full input surface: platform, its
 * tier/band/type/hosting/gateway selection, volume, AOV, selected premium apps, and
 * the three Miyagi SKU toggles. Next-free (mirrors `lib/cost-comparator.ts`) so a
 * unit spec can build → parse and assert an exact round trip with zero framework in
 * the require graph.
 *
 * `app/(shell)/comparador/page.tsx` (SSR prefill, US-1.3) and `ComparadorTool`'s
 * "Copiar enlace" share button (US-2.2, client-side) both go through this ONE codec
 * — the promoter/consultant leave-behind link
 * (`app/(shell)/vende/promotor/sell-sheet/page.tsx`) points at `/comparador`
 * generically (no per-visit data to prefill from a static printable page), but a
 * live session's "Copiar enlace" always round-trips through here.
 *
 * SCOPE NOTE — line overrides are NOT part of the URL. US-1.3's inline per-figure
 * edits are a power-user, in-session action; the consultant prefill use case (epic
 * README §"What already exists", sprint-2.md US-2.2) is about handing over
 * platform/volume/AOV/apps for a live visit, not a pre-edited line item. Carrying
 * overrides would also make share URLs unboundedly long. Documented gap, not a
 * silent omission — noted in the epic PR.
 */

import type {
  ShopifyTier,
  MlBand,
  MlPublicationType,
  WooCommerceHostingTier,
  TiendanubeTier,
} from './cost-comparator'

export type CompetitorPlatform = 'shopify' | 'mercadolibre' | 'woocommerce' | 'tiendanube'

export const COMPARADOR_PLATFORMS: CompetitorPlatform[] = ['shopify', 'mercadolibre', 'woocommerce', 'tiendanube']
export const COMPARADOR_SHOPIFY_TIERS: ShopifyTier[] = ['basico', 'crecimiento', 'avanzado']
export const COMPARADOR_ML_BANDS: MlBand[] = ['baja', 'media', 'alta']
export const COMPARADOR_ML_TYPES: MlPublicationType[] = ['clasica', 'premium']
export const COMPARADOR_WOO_TIERS: WooCommerceHostingTier[] = ['entrada', 'crecimiento']
export const COMPARADOR_TN_TIERS: TiendanubeTier[] = ['gratis', 'basico', 'tiendanube', 'avanzado']

export interface ComparadorMiyagiSkus {
  subdomain: boolean
  customDomain: boolean
  mlSync: boolean
}

export interface ComparadorState {
  platform: CompetitorPlatform
  shopifyTier: ShopifyTier
  mlBand: MlBand
  mlPublicationType: MlPublicationType
  wooTier: WooCommerceHostingTier
  tnTier: TiendanubeTier
  tnOwnGateway: boolean
  volume: number
  aov: number
  selectedAppIds: string[]
  miyagiSkus: ComparadorMiyagiSkus
}

/** The shape Next.js hands a Server Component's `searchParams`, and what
 * `URLSearchParams` looks like through a small adapter — either works as `sp`. */
export type SearchParamsLike = Record<string, string | string[] | undefined>

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

function toNumber(v: string | string[] | undefined, fallback: number): number {
  const raw = first(v)
  if (raw === undefined) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function pick<T extends string>(v: string | string[] | undefined, allowed: T[], fallback: T): T {
  const raw = first(v)
  return (allowed as string[]).includes(raw ?? '') ? (raw as T) : fallback
}

function boolParam(v: string | string[] | undefined): boolean {
  return first(v) === '1'
}

/** `URLSearchParams` → the plain record shape `parseComparadorState` reads. */
export function searchParamsToRecord(params: URLSearchParams): SearchParamsLike {
  const rec: SearchParamsLike = {}
  for (const key of params.keys()) rec[key] = params.get(key) ?? undefined
  return rec
}

/**
 * Parse the comparator's full state from query params. `validAppIds` scopes the
 * `apps` param to app ids the current dataset actually offers — an unknown/typo'd
 * id is silently dropped (never fabricates a selection), same fail-open discipline
 * as `applyDatasetOverrides`.
 */
export function parseComparadorState(sp: SearchParamsLike, validAppIds: readonly string[]): ComparadorState {
  const appsRaw = first(sp.apps)
  const selectedAppIds = appsRaw
    ? appsRaw.split(',').map((s) => s.trim()).filter((id) => id.length > 0 && validAppIds.includes(id))
    : []

  return {
    platform: pick(sp.platform, COMPARADOR_PLATFORMS, 'shopify'),
    shopifyTier: pick(sp.tier, COMPARADOR_SHOPIFY_TIERS, 'basico'),
    mlBand: pick(sp.band, COMPARADOR_ML_BANDS, 'media'),
    mlPublicationType: pick(sp.type, COMPARADOR_ML_TYPES, 'clasica'),
    wooTier: pick(sp.hosting, COMPARADOR_WOO_TIERS, 'entrada'),
    tnTier: pick(sp.tier, COMPARADOR_TN_TIERS, 'basico'),
    tnOwnGateway: first(sp.gateway) !== 'external',
    volume: toNumber(sp.volume, 100),
    aov: toNumber(sp.aov, 500),
    selectedAppIds,
    miyagiSkus: {
      subdomain: boolParam(sp.sub),
      customDomain: boolParam(sp.dom),
      mlSync: boolParam(sp.mlsync),
    },
  }
}

/** Build the `/comparador` query string that round-trips `state` through
 * `parseComparadorState` — only the platform's OWN tier/band params are written
 * (no stale params from a platform the visitor already switched away from). */
export function buildComparadorShareParams(state: ComparadorState): URLSearchParams {
  const params = new URLSearchParams()
  params.set('platform', state.platform)

  if (state.platform === 'shopify') {
    params.set('tier', state.shopifyTier)
  } else if (state.platform === 'mercadolibre') {
    params.set('band', state.mlBand)
    params.set('type', state.mlPublicationType)
  } else if (state.platform === 'woocommerce') {
    params.set('hosting', state.wooTier)
  } else if (state.platform === 'tiendanube') {
    params.set('tier', state.tnTier)
    if (!state.tnOwnGateway) params.set('gateway', 'external')
  }

  params.set('volume', String(state.volume))
  params.set('aov', String(state.aov))
  if (state.selectedAppIds.length > 0) params.set('apps', state.selectedAppIds.join(','))
  if (state.miyagiSkus.subdomain) params.set('sub', '1')
  if (state.miyagiSkus.customDomain) params.set('dom', '1')
  if (state.miyagiSkus.mlSync) params.set('mlsync', '1')

  return params
}
