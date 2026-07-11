'use client'

/**
 * Apoyos y propinas (slug `apoyo`) — the support-widget settings card.
 * Split out of the old `Canal.tsx` mega-section (catalog-management epic,
 * Sprint 6 · Story 6.2) — the federation half (custom domain/subdomain/embed)
 * moved to its own page under Catálogo, `/shop/manage/canal-propio`.
 *
 * Behavior-preserving: persists only the `support` slice through
 * `useSettingsSave()` → `PATCH /api/sell/shop` (deep-merged, siblings
 * untouched) — the exact same save path the old Canal.tsx used, just without
 * the domain/slug logic sharing the same save bar.
 */

import { useState } from 'react'
import { useSettingsSave } from '../_components/useSettingsSave'
import { Toast } from '@/components/feedback/Toast'
import { SectionSaveBar } from '../_components/SectionSaveBar'
import SupportWidgetSection from '../SupportWidgetSection'
import { coerceSupportSettings } from '@/lib/support-widget'
import type { SettingsTree } from '@/lib/shop-settings/types'

export interface ApoyoInitial {
  /** Raw support slice — coerced to defaults below, exactly as Canal.tsx did. */
  support?: SettingsTree['support'] | null
  /** Brand accent — feeds the support widget preview. */
  accent?: string | null
}

export default function Apoyo({ initial }: { initial: ApoyoInitial }) {
  const { save, saving, toast, dismissToast, isDirty, markDirty } = useSettingsSave()
  const mark = markDirty
  const accentColor = initial.accent ?? '#1d6f42'

  const supportSettings = coerceSupportSettings(initial.support)
  const [supportEnabled, setSupportEnabled] = useState(supportSettings.enabled)
  const [supportPresetPesos, setSupportPresetPesos] = useState<number[]>(
    supportSettings.preset_amount_cents.map(amount => amount / 100)
  )
  const [supportCustomMinPesos, setSupportCustomMinPesos] = useState(supportSettings.custom_min_cents / 100)
  const [supportCustomMaxPesos, setSupportCustomMaxPesos] = useState(supportSettings.custom_max_cents / 100)
  const [supportDefaultVisibility, setSupportDefaultVisibility] = useState<'public' | 'private'>(supportSettings.default_visibility)
  const [supportProductId, setSupportProductId] = useState<string | null>(supportSettings.support_product_id ?? null)
  const [supportError, setSupportError] = useState('')

  function setSupportPreset(index: number, value: number) {
    setSupportPresetPesos((current) => current.map((amount, i) => i === index ? value : amount))
    mark()
  }
  function clearSupportError() { setSupportError('') }
  function scrollToApoyo() {
    document.getElementById('apoyo')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function handleSave() {
    const supportPresetCents = supportPresetPesos.map(amount => Math.round(Number(amount) * 100))
    const supportMinCents = Math.round(Number(supportCustomMinPesos) * 100)
    const supportMaxCents = Math.round(Number(supportCustomMaxPesos) * 100)
    if (supportEnabled) {
      let err = ''
      if (supportPresetCents.length !== 3 || supportPresetCents.some(amount => !Number.isFinite(amount) || amount <= 0)) {
        err = 'Configura exactamente tres montos de apoyo válidos.'
      } else if (!Number.isFinite(supportMinCents) || !Number.isFinite(supportMaxCents) || supportMinCents < 100 || supportMinCents > supportMaxCents) {
        err = 'Revisa el mínimo y máximo de apoyo.'
      } else if (supportMaxCents > 500000) {
        err = 'El máximo de apoyo no puede superar $5,000 MXN.'
      } else if (supportPresetCents.some(amount => amount < supportMinCents || amount > supportMaxCents)) {
        err = 'Los montos sugeridos deben estar dentro del rango personalizado.'
      }
      if (err) { setSupportError(err); scrollToApoyo(); return }
    }
    setSupportError('')
    const safeSupportPresetCents = supportPresetCents.every(amount => Number.isFinite(amount) && amount > 0)
      ? supportPresetCents
      : [5000, 10000, 20000]
    const safeSupportMinCents = Number.isFinite(supportMinCents) ? Math.max(100, supportMinCents) : 2000
    const safeSupportMaxCents = Number.isFinite(supportMaxCents)
      ? Math.max(safeSupportMinCents, supportMaxCents)
      : 500000

    await save({
      settings: {
        support: {
          enabled: supportEnabled,
          preset_amount_cents: safeSupportPresetCents,
          custom_min_cents: safeSupportMinCents,
          custom_max_cents: safeSupportMaxCents,
          currency: 'MXN',
          default_visibility: supportDefaultVisibility,
          support_product_id: supportProductId,
        },
      },
    }, {
      onFieldError: (field, message) => { if (field === 'support') { setSupportError(message); scrollToApoyo() } },
      onSuccess: (data) => { if (data.support_product_id) setSupportProductId(data.support_product_id as string) },
    })
  }

  return (
    <div>
      <SupportWidgetSection
        enabled={supportEnabled}
        presetPesos={supportPresetPesos}
        customMinPesos={supportCustomMinPesos}
        customMaxPesos={supportCustomMaxPesos}
        defaultVisibility={supportDefaultVisibility}
        accent={accentColor}
        error={supportError}
        supportProductId={supportProductId}
        onEnabledChange={(value) => { setSupportEnabled(value); mark(); clearSupportError() }}
        onPresetPesosChange={(index, value) => { setSupportPreset(index, value); clearSupportError() }}
        onCustomMinPesosChange={(value) => { setSupportCustomMinPesos(value); mark(); clearSupportError() }}
        onCustomMaxPesosChange={(value) => { setSupportCustomMaxPesos(value); mark(); clearSupportError() }}
        onDefaultVisibilityChange={(value) => { setSupportDefaultVisibility(value); mark() }}
      />

      <SectionSaveBar saving={saving} isDirty={isDirty} onSave={handleSave} />

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  )
}
