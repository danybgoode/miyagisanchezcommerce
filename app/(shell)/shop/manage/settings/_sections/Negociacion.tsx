'use client'

/**
 * Negociación y ofertas — minimum buyer trust gate + automatic A2A negotiation
 * rules. Extracted verbatim from the monolith's `#ofertas` section. Persists only
 * `settings.offers` through useSettingsSave(); behavior-preserving.
 */

import { useState } from 'react'
import { useSettingsSave } from '../_components/useSettingsSave'
import { Toast } from '@/components/feedback/Toast'
import { SectionTitle } from '../_components/SectionTitle'
import { SectionSaveBar } from '../_components/SectionSaveBar'
import { ToggleSwitch } from '../_components/ToggleSwitch'
import type { OffersSettings } from '@/lib/shop-settings/types'

type TrustLevel = 'unverified' | 'basic' | 'trusted' | 'verified' | 'elite'

export default function Negociacion({ initial }: { initial: OffersSettings | null }) {
  const { save, saving, toast, dismissToast, isDirty, markDirty } = useSettingsSave()
  const mark = markDirty

  const offers = initial ?? {}
  const neg = (offers.negotiation ?? {}) as NonNullable<OffersSettings['negotiation']>
  const [minBuyerTrust, setMinBuyerTrust] = useState<TrustLevel>(offers.min_buyer_trust_level ?? 'unverified')
  const [negoEnabled, setNegoEnabled] = useState(neg.enabled ?? false)
  const [acceptPct, setAcceptPct]     = useState(neg.auto_accept_pct ?? 90)
  const [declinePct, setDeclinePct]   = useState(neg.auto_decline_pct ?? 50)
  const [counterPct, setCounterPct]   = useState(neg.auto_counter_pct ?? 75)

  async function handleSave() {
    await save({
      settings: {
        offers: {
          min_buyer_trust_level: minBuyerTrust,
          negotiation: {
            enabled:          negoEnabled,
            auto_accept_pct:  acceptPct,
            auto_decline_pct: declinePct,
            auto_counter_pct: counterPct,
          },
        },
      },
    })
  }

  return (
    <div>
      <section id="ofertas" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <SectionTitle>Ofertas y Negociación</SectionTitle>

        {/* Trust gate */}
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-1">
            Nivel mínimo de comprador
          </p>
          <p className="text-xs text-[var(--color-muted)] mb-3">
            Los compradores por debajo del nivel elegido no podrán enviarte una oferta.
          </p>
          <div className="space-y-2">
            {([
              { value: 'unverified', label: '⚠️ Sin verificar', desc: 'Cualquier persona puede hacer una oferta.' },
              { value: 'basic',      label: '📧 Básico',        desc: 'Solo compradores con correo verificado.' },
              { value: 'trusted',    label: '🤝 Confiable',     desc: 'Correo + teléfono o al menos 1 compra previa.' },
              { value: 'verified',   label: '✓ Verificado',     desc: 'Historial sólido de compras y cuenta establecida.' },
              { value: 'elite',      label: '⭐ Elite',         desc: 'Solo los compradores más confiables de la plataforma.' },
            ] as const).map(opt => (
              <label
                key={opt.value}
                className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                  minBuyerTrust === opt.value
                    ? 'border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,white)]'
                    : 'border-[var(--color-border)] hover:border-gray-400'
                }`}
              >
                <input type="radio" name="min_buyer_trust" value={opt.value}
                  checked={minBuyerTrust === opt.value}
                  onChange={() => { setMinBuyerTrust(opt.value); mark() }}
                  className="accent-[var(--color-accent)]" />
                <div>
                  <div className="text-sm font-semibold">{opt.label}</div>
                  <div className="text-xs text-[var(--color-muted)]">{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Negotiation rules */}
        <div className="pt-5 border-t border-[var(--color-border)]">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-1">
            Negociación automática
          </p>
          <p className="text-xs text-[var(--color-muted)] mb-3">
            Responde ofertas automáticamente sin revisar cada una. Ideal para catálogos grandes.
          </p>
          <div className="divide-y divide-[var(--color-border)]">
            <ToggleSwitch
              checked={negoEnabled}
              onChange={v => { setNegoEnabled(v); mark() }}
              label="Activar negociación automática"
              description="Las ofertas dentro de tus rangos se responden al instante."
            />
          </div>

          {negoEnabled && (
            <div className="mt-4 space-y-4">
              {[
                { label: 'Aceptar automáticamente si la oferta es ≥', value: acceptPct, set: setAcceptPct, color: 'green', hint: `Ofertas a ${acceptPct}% o más del precio de lista se aceptan al instante.` },
                { label: 'Contraofertear al', value: counterPct, set: setCounterPct, color: 'amber', hint: `Si la oferta está entre ${declinePct}% y ${acceptPct}%, se contraoferta al ${counterPct}% del precio.` },
                { label: 'Rechazar automáticamente si la oferta es <', value: declinePct, set: setDeclinePct, color: 'red', hint: `Ofertas por debajo del ${declinePct}% se rechazan automáticamente.` },
              ].map(row => (
                <div key={row.label}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sm font-medium">{row.label}</label>
                    <span className={`text-sm font-bold tabular-nums ${
                      row.color === 'green' ? 'text-green-700' : row.color === 'amber' ? 'text-amber-700' : 'text-red-700'
                    }`}>{row.value}%</span>
                  </div>
                  <input
                    type="range" min={0} max={100} step={5}
                    value={row.value}
                    onChange={e => { row.set(parseInt(e.target.value)); mark() }}
                    className="w-full accent-[var(--color-accent)]"
                  />
                  <p className="text-xs text-[var(--color-muted)] mt-0.5">{row.hint}</p>
                </div>
              ))}

              {declinePct >= acceptPct && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  ⚠ El porcentaje de rechazo ({declinePct}%) debe ser menor al de aceptación ({acceptPct}%).
                </p>
              )}
              {counterPct > acceptPct && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  ⚠ El porcentaje de contraoferta ({counterPct}%) debe ser menor o igual al de aceptación ({acceptPct}%).
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      <SectionSaveBar saving={saving} isDirty={isDirty} onSave={handleSave} />

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  )
}
