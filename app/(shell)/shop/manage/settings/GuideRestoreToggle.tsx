'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ToggleSwitch } from './_components/ToggleSwitch'
import { useSettingsSave } from './_components/useSettingsSave'
import { pushAnalyticsEvent } from '@/lib/analytics-events'

/**
 * Restore toggle for the dashboard "Pon tu tienda en marcha" guide
 * (seller-portal-setup-guide epic, B.3). The guide's own "Ocultar" button sets
 * `guide_dismissed: true`; this is the way back. Same PATCH seam every
 * settings section uses, then `router.refresh()` so Resumen picks up the
 * flag on next visit.
 */
export default function GuideRestoreToggle({ initialDismissed }: { initialDismissed: boolean }) {
  const router = useRouter()
  const { save, saving } = useSettingsSave()
  const [dismissed, setDismissed] = useState(initialDismissed)

  const handleChange = useCallback(
    async (shown: boolean) => {
      setDismissed(!shown)
      const ok = await save({ settings: { guide: { guide_dismissed: !shown } } })
      if (!ok) {
        setDismissed((prev) => !prev)
      } else {
        if (shown) pushAnalyticsEvent('guide_restore')
        router.refresh()
      }
    },
    [save, router],
  )

  return (
    <div style={{ marginBottom: 16, padding: '4px 16px', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
      <ToggleSwitch
        checked={!dismissed}
        onChange={handleChange}
        disabled={saving}
        label="Guía de configuración en el panel"
        description="Muestra la tarjeta 'Pon tu tienda en marcha' en tu Resumen."
      />
    </div>
  )
}
