'use client'

import { useMemo, useState } from 'react'
import {
  computeShopifyCost,
  computeMercadoLibreCost,
  computeWooCommerceCost,
  computeTiendanubeCost,
  computeMiyagiCost,
  computeSelectedAppsMonthlyMxn,
  applyLineOverrides,
  formatMxn,
  type ShopifyRates,
  type MercadoLibreRates,
  type WooCommerceRates,
  type TiendanubeRates,
  type MiyagiRates,
  type ShopifyTier,
  type MlBand,
  type MlPublicationType,
  type WooCommerceHostingTier,
  type TiendanubeTier,
  type PremiumAppOption,
  type StackedCost,
} from '@/lib/cost-comparator'
import { lineSourceHint, type ComparatorDataset } from '@/lib/cost-comparator-dataset'
import { pushAnalyticsEvent } from '@/lib/analytics-events'

export type CompetitorPlatform = 'shopify' | 'mercadolibre' | 'woocommerce' | 'tiendanube'

const PLATFORM_LABELS: Record<CompetitorPlatform, string> = {
  shopify: 'Shopify',
  mercadolibre: 'Mercado Libre',
  woocommerce: 'WooCommerce',
  tiendanube: 'Tiendanube',
}

// "Basic" / "Grow" / "Advanced" are Shopify's own plan brand names (unchanged
// even on Shopify's own es-MX pricing page) — they stay as-is per AGENTS rule 5
// ("brand names stay as-is"), presented as "Plan <Nombre>" so they read as a
// proper-noun plan name rather than a stray English word.
const SHOPIFY_TIER_LABELS: Record<ShopifyTier, string> = {
  basico: 'Plan Basic (~$19 USD/mes)',
  crecimiento: 'Plan Grow (~$52 USD/mes)',
  avanzado: 'Plan Advanced (~$399 USD/mes)',
}

const ML_BAND_LABELS: Record<MlBand, string> = {
  baja: 'Comisión baja (ej. electrónica)',
  media: 'Comisión media (ej. hogar)',
  alta: 'Comisión alta (ej. ropa, joyería)',
}

const WOO_TIER_LABELS: Record<WooCommerceHostingTier, string> = {
  entrada: 'Alojamiento de entrada (~$19 USD/mes)',
  crecimiento: 'Alojamiento de crecimiento (~$28 USD/mes)',
}

const TN_TIER_LABELS: Record<TiendanubeTier, string> = {
  gratis: 'Gratis',
  basico: 'Básico ($149 MXN/mes)',
  tiendanube: 'Tiendanube ($374 MXN/mes)',
  avanzado: 'Avanzado ($999 MXN/mes)',
}

export interface ComparadorInitial {
  platform: CompetitorPlatform
  shopifyTier: ShopifyTier
  mlBand: MlBand
  mlPublicationType: MlPublicationType
  wooTier: WooCommerceHostingTier
  tnTier: TiendanubeTier
  tnOwnGateway: boolean
  volume: number
  aov: number
}

export interface ComparadorRates {
  shopify: ShopifyRates
  mercadolibre: MercadoLibreRates
  woocommerce: WooCommerceRates
  tiendanube: TiendanubeRates
  miyagi: MiyagiRates
}

interface ComparadorToolProps {
  rates: ComparadorRates
  apps: PremiumAppOption[]
  fx: number
  initial: ComparadorInitial
  dataset: ComparatorDataset
}

function EditableLine({
  testId,
  label,
  value,
  original,
  sourceHint,
  onChange,
}: {
  testId: string
  label: string
  value: number
  original: number
  sourceHint: string
  onChange: (next: number) => void
}) {
  const overridden = Math.round(value * 100) !== Math.round(original * 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s-3)', padding: '6px 0' }}>
      <span
        className="t-small"
        title={sourceHint}
        data-testid={`${testId}-source`}
        style={{ color: 'var(--fg-muted)', flex: '1 1 auto', minWidth: 0, cursor: 'help', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}
      >
        {label}
        <i className="iconoir-info-circle" aria-hidden="true" style={{ marginLeft: 4, fontSize: 12, color: 'var(--fg-subtle)', verticalAlign: 'middle' }} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
        <input
          type="number"
          step="0.01"
          className="input"
          data-testid={testId}
          title={sourceHint}
          value={value}
          onChange={(e) => {
            const next = e.target.valueAsNumber
            onChange(Number.isFinite(next) ? next : 0)
          }}
          style={{ width: 110, textAlign: 'right', padding: '4px 8px', fontSize: 13 }}
        />
        {overridden ? (
          <span className="t-caption" style={{ color: 'var(--fg-subtle)', marginTop: 2 }}>
            Original: {formatMxn(original)}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function StackedBar({
  testId,
  label,
  stackResult,
  maxTotal,
  color,
}: {
  testId: string
  label: string
  stackResult: StackedCost
  maxTotal: number
  color: string
}) {
  const widthPct = maxTotal > 0 ? Math.min(100, (stackResult.monthlyTotalMxn / maxTotal) * 100) : 0
  return (
    <div style={{ marginBottom: 'var(--s-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="t-small" style={{ fontWeight: 600, color: 'var(--fg)' }}>{label}</span>
        <span className="t-small" data-testid={testId} style={{ fontWeight: 700, color: 'var(--accent)' }}>
          {formatMxn(stackResult.monthlyTotalMxn)}/mes
        </span>
      </div>
      <div style={{ display: 'flex', height: 22, borderRadius: 'var(--r-md)', overflow: 'hidden', background: 'var(--bg-sunk)', width: '100%' }}>
        <div style={{ width: `${widthPct}%`, background: color, minWidth: stackResult.monthlyTotalMxn > 0 ? 4 : 0, transition: 'width 120ms ease' }} />
      </div>
    </div>
  )
}

export default function ComparadorTool({ rates, apps, fx, initial, dataset }: ComparadorToolProps) {
  const [platform, setPlatform] = useState<CompetitorPlatform>(initial.platform)
  const [shopifyTier, setShopifyTier] = useState<ShopifyTier>(initial.shopifyTier)
  const [mlBand, setMlBand] = useState<MlBand>(initial.mlBand)
  const [mlPublicationType, setMlPublicationType] = useState<MlPublicationType>(initial.mlPublicationType)
  const [wooTier, setWooTier] = useState<WooCommerceHostingTier>(initial.wooTier)
  const [tnTier, setTnTier] = useState<TiendanubeTier>(initial.tnTier)
  const [tnOwnGateway, setTnOwnGateway] = useState(initial.tnOwnGateway)
  const [volume, setVolume] = useState(initial.volume)
  const [aov, setAov] = useState(initial.aov)
  const [selectedAppIds, setSelectedAppIds] = useState<string[]>([])
  const [miyagiSkus, setMiyagiSkus] = useState({ subdomain: false, customDomain: false, mlSync: false })
  const [lineOverrides, setLineOverrides] = useState<Record<string, number>>({})
  const [interacted, setInteracted] = useState(false)

  // `nextPlatform` lets the platform-change handler pass the value it's ABOUT to
  // set — `setPlatform` is async (queued), so reading the `platform` closure
  // variable at call time would still read the PREVIOUS value for that one
  // interaction and misattribute the "first calculation" event to it.
  const markInteracted = (nextPlatform?: CompetitorPlatform) => {
    if (interacted) return
    setInteracted(true)
    pushAnalyticsEvent('comparador_calculated', { platform: nextPlatform ?? platform }, { dedupeKey: 'comparador_calculated' })
  }

  const inputs = { volumeMonthly: Math.max(0, volume), aovMxn: Math.max(0, aov) }

  const appsMonthlyMxn = useMemo(
    () => computeSelectedAppsMonthlyMxn(apps, selectedAppIds, fx),
    [apps, selectedAppIds, fx],
  )

  // Current tier/band key — used to namespace line overrides so switching tiers
  // doesn't silently carry a stale hand-edited number into a different tier's row.
  const tierKey = useMemo(() => {
    switch (platform) {
      case 'shopify': return shopifyTier
      case 'mercadolibre': return `${mlBand}-${mlPublicationType}`
      case 'woocommerce': return wooTier
      case 'tiendanube': return `${tnTier}-${tnOwnGateway ? 'own' : 'ext'}`
    }
  }, [platform, shopifyTier, mlBand, mlPublicationType, wooTier, tnTier, tnOwnGateway])

  const baseCompetitorStack = useMemo<StackedCost>(() => {
    switch (platform) {
      case 'shopify':
        return computeShopifyCost(inputs, shopifyTier, rates.shopify, appsMonthlyMxn)
      case 'mercadolibre':
        return computeMercadoLibreCost(inputs, mlBand, mlPublicationType, rates.mercadolibre, appsMonthlyMxn)
      case 'woocommerce':
        return computeWooCommerceCost(inputs, wooTier, rates.woocommerce, appsMonthlyMxn)
      case 'tiendanube':
        return computeTiendanubeCost(inputs, tnTier, tnOwnGateway, rates.tiendanube, appsMonthlyMxn)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, inputs.volumeMonthly, inputs.aovMxn, shopifyTier, mlBand, mlPublicationType, wooTier, tnTier, tnOwnGateway, appsMonthlyMxn, rates])

  const baseMiyagiStack = useMemo<StackedCost>(
    () => computeMiyagiCost(inputs, miyagiSkus, rates.miyagi),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inputs.volumeMonthly, inputs.aovMxn, miyagiSkus, rates.miyagi],
  )

  const competitorOverrideKey = (lineKey: string) => `${platform}:${tierKey}:${lineKey}`
  const miyagiOverrideKey = (lineKey: string) => `miyagi:${lineKey}`

  const competitorStack = useMemo(() => {
    const scoped: Record<string, number> = {}
    for (const line of baseCompetitorStack.lines) {
      const k = competitorOverrideKey(line.key)
      if (lineOverrides[k] !== undefined) scoped[line.key] = lineOverrides[k]
    }
    return applyLineOverrides(baseCompetitorStack, scoped)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseCompetitorStack, lineOverrides, platform, tierKey])

  const miyagiStack = useMemo(() => {
    const scoped: Record<string, number> = {}
    for (const line of baseMiyagiStack.lines) {
      const k = miyagiOverrideKey(line.key)
      if (lineOverrides[k] !== undefined) scoped[line.key] = lineOverrides[k]
    }
    return applyLineOverrides(baseMiyagiStack, scoped)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseMiyagiStack, lineOverrides])

  const maxMonthly = Math.max(competitorStack.monthlyTotalMxn, miyagiStack.monthlyTotalMxn, 1)
  const maxAnnual = Math.max(competitorStack.annualTotalMxn, miyagiStack.annualTotalMxn, 1)

  // The tier/band selections currently in effect — feeds lineSourceHint() so each
  // editable line's hover tooltip cites the figure that actually backs it right now
  // (e.g. Shopify's "payment" line cites the Basic-tier rate while Basic is picked,
  // the Advanced-tier rate once Advanced is picked).
  const sourceCtx = { shopifyTier, mlBand, mlPublicationType, wooTier, tnTier, tnOwnGateway }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {/* Platform + tier pickers */}
      <div className="card-panel" style={{ padding: 'var(--s-5)', display: 'grid', gap: 'var(--s-4)' }}>
        <label style={{ display: 'grid', gap: 'var(--s-1)' }}>
          <span className="t-small" style={{ color: 'var(--fg-muted)' }}>Plataforma con la que comparas</span>
          <select
            className="input"
            data-testid="comparador-platform-select"
            value={platform}
            onChange={(e) => {
              const next = e.target.value as CompetitorPlatform
              setPlatform(next)
              markInteracted(next)
            }}
          >
            {(Object.keys(PLATFORM_LABELS) as CompetitorPlatform[]).map((p) => (
              <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
            ))}
          </select>
        </label>

        {platform === 'shopify' && (
          <label style={{ display: 'grid', gap: 'var(--s-1)' }}>
            <span className="t-small" style={{ color: 'var(--fg-muted)' }}>Plan de Shopify</span>
            <select className="input" data-testid="comparador-shopify-tier-select" value={shopifyTier} onChange={(e) => { setShopifyTier(e.target.value as ShopifyTier); markInteracted() }}>
              {(Object.keys(SHOPIFY_TIER_LABELS) as ShopifyTier[]).map((t) => (
                <option key={t} value={t}>{SHOPIFY_TIER_LABELS[t]}</option>
              ))}
            </select>
          </label>
        )}

        {platform === 'mercadolibre' && (
          <>
            <label style={{ display: 'grid', gap: 'var(--s-1)' }}>
              <span className="t-small" style={{ color: 'var(--fg-muted)' }}>Categoría (banda de comisión)</span>
              <select className="input" data-testid="comparador-ml-band-select" value={mlBand} onChange={(e) => { setMlBand(e.target.value as MlBand); markInteracted() }}>
                {(Object.keys(ML_BAND_LABELS) as MlBand[]).map((b) => (
                  <option key={b} value={b}>{ML_BAND_LABELS[b]}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 'var(--s-1)' }}>
              <span className="t-small" style={{ color: 'var(--fg-muted)' }}>Tipo de publicación</span>
              <select className="input" data-testid="comparador-ml-type-select" value={mlPublicationType} onChange={(e) => { setMlPublicationType(e.target.value as MlPublicationType); markInteracted() }}>
                <option value="clasica">Clásica</option>
                <option value="premium">Premium</option>
              </select>
            </label>
          </>
        )}

        {platform === 'woocommerce' && (
          <label style={{ display: 'grid', gap: 'var(--s-1)' }}>
            <span className="t-small" style={{ color: 'var(--fg-muted)' }}>Alojamiento</span>
            <select className="input" data-testid="comparador-woo-tier-select" value={wooTier} onChange={(e) => { setWooTier(e.target.value as WooCommerceHostingTier); markInteracted() }}>
              {(Object.keys(WOO_TIER_LABELS) as WooCommerceHostingTier[]).map((t) => (
                <option key={t} value={t}>{WOO_TIER_LABELS[t]}</option>
              ))}
            </select>
          </label>
        )}

        {platform === 'tiendanube' && (
          <>
            <label style={{ display: 'grid', gap: 'var(--s-1)' }}>
              <span className="t-small" style={{ color: 'var(--fg-muted)' }}>Plan de Tiendanube</span>
              <select className="input" data-testid="comparador-tn-tier-select" value={tnTier} onChange={(e) => { setTnTier(e.target.value as TiendanubeTier); markInteracted() }}>
                {(Object.keys(TN_TIER_LABELS) as TiendanubeTier[]).map((t) => (
                  <option key={t} value={t}>{TN_TIER_LABELS[t]}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
              <input type="checkbox" checked={tnOwnGateway} onChange={(e) => { setTnOwnGateway(e.target.checked); markInteracted() }} data-testid="comparador-tn-gateway-toggle" />
              <span className="t-small" style={{ color: 'var(--fg-muted)' }}>Usar Pago Nube (si no, pasarela externa)</span>
            </label>
          </>
        )}
      </div>

      {/* Volume + AOV */}
      <div className="card-panel" style={{ padding: 'var(--s-5)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 'var(--s-4)' }}>
        <label style={{ display: 'grid', gap: 'var(--s-1)' }}>
          <span className="t-small" style={{ color: 'var(--fg-muted)' }}>Ventas al mes</span>
          <input
            type="number"
            min={0}
            className="input"
            data-testid="comparador-volume-input"
            value={volume}
            onChange={(e) => { const n = e.target.valueAsNumber; setVolume(Number.isFinite(n) ? n : 0); markInteracted() }}
          />
        </label>
        <label style={{ display: 'grid', gap: 'var(--s-1)' }}>
          <span className="t-small" style={{ color: 'var(--fg-muted)' }}>Ticket promedio (MXN)</span>
          <input
            type="number"
            min={0}
            className="input"
            data-testid="comparador-aov-input"
            value={aov}
            onChange={(e) => { const n = e.target.valueAsNumber; setAov(Number.isFinite(n) ? n : 0); markInteracted() }}
          />
        </label>
      </div>

      {/* Premium apps */}
      <div className="card-panel" style={{ padding: 'var(--s-5)' }}>
        <p className="t-small" style={{ fontWeight: 600, marginBottom: 'var(--s-3)' }}>Apps premium que ya pagas</p>
        <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
          {apps.map((app) => (
            <label key={app.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s-3)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', minWidth: 0 }}>
                <input
                  type="checkbox"
                  data-testid={`comparador-app-${app.id}`}
                  checked={selectedAppIds.includes(app.id)}
                  onChange={(e) => {
                    setSelectedAppIds((prev) => (e.target.checked ? [...prev, app.id] : prev.filter((id) => id !== app.id)))
                    markInteracted()
                  }}
                />
                <span className="t-small" style={{ color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.label}</span>
              </span>
              <span className="t-caption" style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                ~{formatMxn(app.monthlyUsd * fx)}/mes ·{' '}
                {app.miyagiIncluded ? (
                  <span className="badge badge-verified" style={{ fontSize: 10 }}>Incluido en Miyagi</span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Miyagi SKU toggles */}
      <div className="card-panel" style={{ padding: 'var(--s-5)' }}>
        <p className="t-small" style={{ fontWeight: 600, marginBottom: 'var(--s-3)' }}>Extras opcionales de Miyagi</p>
        <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s-3)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
              <input type="checkbox" data-testid="comparador-miyagi-subdomain" checked={miyagiSkus.subdomain} onChange={(e) => { setMiyagiSkus((s) => ({ ...s, subdomain: e.target.checked })); markInteracted() }} />
              <span className="t-small">Subdominio propio</span>
            </span>
            <span className="t-caption" style={{ color: 'var(--fg-muted)' }}>{formatMxn(rates.miyagi.subdomainMonthlyMxn)}/mes</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s-3)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
              <input type="checkbox" data-testid="comparador-miyagi-domain" checked={miyagiSkus.customDomain} onChange={(e) => { setMiyagiSkus((s) => ({ ...s, customDomain: e.target.checked })); markInteracted() }} />
              <span className="t-small">Dominio propio</span>
            </span>
            <span className="t-caption" style={{ color: 'var(--fg-muted)' }}>{formatMxn(rates.miyagi.customDomainMonthlyMxn)}/mes</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s-3)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
              <input type="checkbox" data-testid="comparador-miyagi-mlsync" checked={miyagiSkus.mlSync} onChange={(e) => { setMiyagiSkus((s) => ({ ...s, mlSync: e.target.checked })); markInteracted() }} />
              <span className="t-small">Sincronización con Mercado Libre</span>
            </span>
            <span className="t-caption" style={{ color: 'var(--fg-muted)' }}>{formatMxn(rates.miyagi.mlSyncMonthlyMxn)}/mes</span>
          </label>
        </div>
      </div>

      {/* Stacked bars */}
      <div className="card-panel" style={{ padding: 'var(--s-5)' }}>
        <p className="t-small" style={{ fontWeight: 600, marginBottom: 'var(--s-3)' }}>Costo mensual</p>
        <StackedBar testId="comparador-monthly-competitor-total" label={PLATFORM_LABELS[platform]} stackResult={competitorStack} maxTotal={maxMonthly} color="var(--fg-subtle)" />
        <StackedBar testId="comparador-monthly-miyagi-total" label="Miyagi Sánchez" stackResult={miyagiStack} maxTotal={maxMonthly} color="var(--accent)" />

        <p className="t-small" style={{ fontWeight: 600, margin: 'var(--s-5) 0 var(--s-3)' }}>Costo anual</p>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span className="t-small" style={{ color: 'var(--fg)' }}>{PLATFORM_LABELS[platform]}</span>
          <span className="t-small" data-testid="comparador-annual-competitor-total" style={{ fontWeight: 700 }}>{formatMxn(competitorStack.annualTotalMxn)}/año</span>
        </div>
        <div style={{ display: 'flex', height: 18, borderRadius: 'var(--r-md)', overflow: 'hidden', background: 'var(--bg-sunk)', marginBottom: 'var(--s-3)' }}>
          <div style={{ width: `${Math.min(100, (competitorStack.annualTotalMxn / maxAnnual) * 100)}%`, background: 'var(--fg-subtle)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span className="t-small" style={{ color: 'var(--fg)' }}>Miyagi Sánchez</span>
          <span className="t-small" data-testid="comparador-annual-miyagi-total" style={{ fontWeight: 700, color: 'var(--accent)' }}>{formatMxn(miyagiStack.annualTotalMxn)}/año</span>
        </div>
        <div style={{ display: 'flex', height: 18, borderRadius: 'var(--r-md)', overflow: 'hidden', background: 'var(--bg-sunk)' }}>
          <div style={{ width: `${Math.min(100, (miyagiStack.annualTotalMxn / maxAnnual) * 100)}%`, background: 'var(--accent)' }} />
        </div>
      </div>

      {/* Editable line items — every figure inline-editable, sourced original as hint */}
      <div className="card-panel" style={{ padding: 'var(--s-5)' }}>
        <p className="t-small" style={{ fontWeight: 600, marginBottom: 'var(--s-2)' }}>{PLATFORM_LABELS[platform]} — detalle</p>
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {competitorStack.lines.map((line, i) => (
            <EditableLine
              key={line.key}
              testId={`comparador-line-${platform}-${line.key}`}
              label={line.label}
              value={line.monthlyMxn}
              original={baseCompetitorStack.lines[i]?.monthlyMxn ?? line.monthlyMxn}
              sourceHint={lineSourceHint(dataset, platform, line.key, sourceCtx)}
              onChange={(next) => {
                setLineOverrides((prev) => ({ ...prev, [competitorOverrideKey(line.key)]: next }))
                markInteracted()
              }}
            />
          ))}
        </div>
        <p className="t-small" style={{ fontWeight: 600, margin: 'var(--s-5) 0 var(--s-2)' }}>Miyagi Sánchez — detalle</p>
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {miyagiStack.lines.map((line, i) => (
            <EditableLine
              key={line.key}
              testId={`comparador-line-miyagi-${line.key}`}
              label={line.label}
              value={line.monthlyMxn}
              original={baseMiyagiStack.lines[i]?.monthlyMxn ?? line.monthlyMxn}
              sourceHint={lineSourceHint(dataset, 'miyagi', line.key, {})}
              onChange={(next) => {
                setLineOverrides((prev) => ({ ...prev, [miyagiOverrideKey(line.key)]: next }))
                markInteracted()
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
