'use client'

/**
 * Notificaciones — the two legacy email-summary toggles persisted in the settings
 * tree (`settings.notifications`), plus the separate granular preference center.
 * Extracted verbatim from the monolith's `#notificaciones` section.
 *
 * IMPORTANT — two independent notification systems coexist here, by design:
 *   1. The two ToggleSwitches below write `settings.notifications.{email_new_view,
 *      email_new_message}` through useSettingsSave() (this section's slice).
 *   2. <NotificationPreferences /> is the granular multi-channel preference center
 *      (#5 / #5b) — a SELF-CONTAINED island that saves to its OWN API/table. We do
 *      NOT route its prefs through useSettingsSave and do NOT merge them into the
 *      settings tree. Behavior-preserving: it sat right below this section in the
 *      monolith and continues to save independently.
 */

import { useState } from 'react'
import { useSettingsSave } from '../_components/useSettingsSave'
import { Toast } from '@/components/feedback/Toast'
import { SectionTitle } from '../_components/SectionTitle'
import { SectionSaveBar } from '../_components/SectionSaveBar'
import { ToggleSwitch } from '../_components/ToggleSwitch'
import NotificationPreferences from '../NotificationPreferences'
import type { NotificationsSettings } from '@/lib/shop-settings/types'

export default function Notificaciones({ initial }: { initial: NotificationsSettings | null }) {
  const { save, saving, toast, dismissToast, isDirty, markDirty } = useSettingsSave()
  const mark = markDirty

  const n = initial ?? {}
  const [emailView, setEmailView]       = useState(n.email_new_view ?? false)
  const [emailMessage, setEmailMessage] = useState(n.email_new_message ?? true)

  async function handleSave() {
    await save({
      settings: {
        notifications: { email_new_view: emailView, email_new_message: emailMessage },
      },
    })
  }

  return (
    <div>
      <section id="notificaciones" className="border border-[var(--color-border)] rounded-[var(--r-lg)] p-5 mb-5">
        <SectionTitle>Notificaciones por correo</SectionTitle>
        <div className="divide-y divide-[var(--color-border)]">
          <ToggleSwitch
            checked={emailMessage}
            onChange={v => { setEmailMessage(v); mark() }}
            label="Nuevo mensaje de un comprador"
          />
          <ToggleSwitch
            checked={emailView}
            onChange={v => { setEmailView(v); mark() }}
            label="Mi anuncio recibió visitas"
            description="Resumen diario cuando tus anuncios tienen nuevas vistas."
          />
        </div>
      </section>

      {/* Granular preference center — channels × event-groups. Self-contained
          island; saves on its own (separate API/table — not the settings tree). */}
      <NotificationPreferences />

      <SectionSaveBar saving={saving} isDirty={isDirty} onSave={handleSave} />

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  )
}
