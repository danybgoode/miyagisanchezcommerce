'use client'

/**
 * Bookshop launchpad — the shop's opt-in for writer submissions (S1.1).
 * Reuses the same settings persistence seam every settings section uses
 * (`useSettingsSave` → PATCH /api/sell/shop, which deep-merges the slice), so
 * this writes `settings.launchpad.{accepts_manuscripts,guidelines}` without
 * re-touching persistence.
 */

import { useState } from 'react'
import { useSettingsSave } from '../settings/_components/useSettingsSave'
import { Toast } from '../settings/_components/Toast'
import { SectionTitle } from '../settings/_components/SectionTitle'
import { SectionSaveBar } from '../settings/_components/SectionSaveBar'
import { ToggleSwitch } from '../settings/_components/ToggleSwitch'

const MAX_GUIDELINES = 2000

export default function ConvocatoriaSettingsClient({
  initial,
  publicUrl,
}: {
  initial: { accepts_manuscripts: boolean; guidelines: string | null }
  publicUrl: string
}) {
  const { save, saving, toast, dismissToast, isDirty, markDirty } = useSettingsSave()
  const [accepts, setAccepts] = useState(initial.accepts_manuscripts)
  const [guidelines, setGuidelines] = useState(initial.guidelines ?? '')

  async function handleSave() {
    await save({
      settings: {
        launchpad: {
          accepts_manuscripts: accepts,
          guidelines: guidelines.trim() || null,
        },
      },
    })
  }

  return (
    <div>
      <section className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <SectionTitle>Convocatoria de manuscritos</SectionTitle>
        <p className="text-sm text-[var(--color-muted)] mb-3 leading-relaxed">
          Abre tu tienda a escritores. Cuando la convocatoria está activa, cualquier
          persona puede enviarte su manuscrito desde una página pública — sin crear cuenta —
          y tú lo revisas y publicas como producto digital.
        </p>

        <div className="divide-y divide-[var(--color-border)]">
          <ToggleSwitch
            checked={accepts}
            onChange={v => { setAccepts(v); markDirty() }}
            label="Recibir manuscritos"
            description="Activa la página pública de convocatoria de tu tienda."
          />
        </div>

        {accepts && (
          <div className="mt-4">
            <label className="block text-sm font-medium mb-1.5">
              Indicaciones para quienes envían (opcional)
            </label>
            <p className="text-xs text-[var(--color-muted)] mb-2 leading-relaxed">
              Qué buscas, géneros, extensión, formato preferido. Se muestra en la página de convocatoria.
            </p>
            <textarea
              value={guidelines}
              onChange={e => { setGuidelines(e.target.value.slice(0, MAX_GUIDELINES)); markDirty() }}
              rows={5}
              placeholder="Ej. Buscamos narrativa breve en español, de 5 000 a 20 000 palabras, en PDF o EPUB…"
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm leading-relaxed"
            />
            <div className="mt-1 text-right text-xs text-[var(--color-muted)]">
              {guidelines.length}/{MAX_GUIDELINES}
            </div>

            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-sm text-[var(--accent)] no-underline hover:underline"
            >
              <i className="iconoir-open-new-window" style={{ fontSize: 14 }} />
              Ver mi página de convocatoria
            </a>
          </div>
        )}
      </section>

      <SectionSaveBar saving={saving} isDirty={isDirty} onSave={handleSave} />
      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  )
}
