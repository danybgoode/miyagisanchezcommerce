'use client'

/**
 * Living Shop — the section manager (epic 07, Story 5.3).
 *
 * Wall and Tienda are visually LOCKED, not merely disabled: they are the
 * homepage and the catalog, and a shop with no route to its products is not a
 * shop. Everything else can be shown, hidden and reordered.
 *
 * Reordering is BUTTONS, not drag-and-drop. Drag is unreachable by keyboard and
 * fiddly on a phone, and this list is at most five items — the affordance that
 * works for everyone is the one that ships. `aria-live` announces each move, so
 * a screen-reader user hears the result instead of having to re-read the list.
 *
 * Impossible states are prevented BEFORE save: the lock means an anchor can
 * never enter `hidden`, and the up/down buttons disable at the ends rather than
 * silently no-oping.
 */

import { useState } from 'react'
import { Toast, useToast } from '@/components/feedback/Toast'
import { OPTIONAL_SECTIONS, REQUIRED_SECTIONS, type SectionConfig, type SectionKey } from '@/lib/shop-presentation/types'

const LABEL: Record<SectionKey, string> = {
  wall: 'Muro',
  shop: 'Tienda',
  collections: 'Colecciones',
  events: 'Eventos',
  about: 'Acerca',
  faq: 'Preguntas frecuentes',
  policies: 'Políticas',
}

const EMPTY_REASON: Record<string, string> = {
  collections: 'Todavía no tienes colecciones, así que no aparecerá.',
  events: 'Todavía no tienes eventos próximos, así que no aparecerá.',
  about: 'Escribe tu página Acerca para que aparezca.',
  faq: 'Agrega preguntas frecuentes para que aparezca.',
  policies: 'Configura tus devoluciones para que aparezca.',
}

export default function SectionsTab({
  value,
  available,
  onChange,
}: {
  value: SectionConfig
  /** What each optional section actually has behind it right now. */
  available: Record<string, boolean>
  onChange: (next: SectionConfig) => void
}) {
  const [saving, setSaving] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const { toast, showToast, dismissToast } = useToast()

  const optional = value.order.filter((k) => !REQUIRED_SECTIONS.includes(k))
  const hidden = new Set(value.hidden)

  function move(key: SectionKey, delta: number) {
    const index = optional.indexOf(key)
    const target = index + delta
    if (index < 0 || target < 0 || target >= optional.length) return
    const next = [...optional]
    next.splice(index, 1)
    next.splice(target, 0, key)
    onChange({ ...value, order: [...REQUIRED_SECTIONS, ...next] })
    setAnnouncement(`${LABEL[key]} ahora está en la posición ${target + 1} de ${next.length}.`)
  }

  function toggle(key: SectionKey) {
    const next = new Set(hidden)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange({ ...value, hidden: [...next] })
    setAnnouncement(`${LABEL[key]} ${next.has(key) ? 'está oculta' : 'se muestra'}.`)
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/sell/shop', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { sections: value } }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; storefront_synced?: boolean }
      if (!res.ok) { showToast(data.error ?? 'No se pudo guardar.', 'error'); return }
      // Saved is not the same as live — see the note in the route. The public
      // shop reads the Medusa seller, and that sync can fail by itself.
      if (data.storefront_synced === false) {
        showToast('Se guardó, pero tu tienda pública todavía no lo muestra. Intenta guardar otra vez.', 'error')
        return
      }
      showToast('Guardado.', 'success')
    } catch {
      showToast('Sin conexión. Intenta de nuevo.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p className="text-sm text-[var(--fg-muted)] mb-4">
        Elige qué secciones ve la gente y en qué orden. Una sección vacía no aparece aunque esté activa.
      </p>

      <ul className="space-y-2 list-none p-0 m-0 mb-5">
        {REQUIRED_SECTIONS.map((key) => (
          <li key={key} className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-sunk)]">
            <i className="iconoir-lock" aria-hidden />
            <span className="font-medium flex-1">{LABEL[key]}</span>
            <span className="text-xs text-[var(--fg-muted)]">Siempre visible</span>
          </li>
        ))}

        {optional.map((key, i) => {
          const isHidden = hidden.has(key)
          const hasContent = available[key] === true
          return (
            <li key={key} className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border)]">
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => move(key, -1)}
                  disabled={i === 0}
                  aria-label={`Subir ${LABEL[key]}`}
                  className="px-1.5 rounded border border-[var(--border)] disabled:opacity-30"
                >
                  <i className="iconoir-nav-arrow-up" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => move(key, 1)}
                  disabled={i === optional.length - 1}
                  aria-label={`Bajar ${LABEL[key]}`}
                  className="px-1.5 rounded border border-[var(--border)] disabled:opacity-30"
                >
                  <i className="iconoir-nav-arrow-down" aria-hidden />
                </button>
              </div>

              <div className="flex-1 min-w-0">
                <span className={`font-medium ${isHidden ? 'text-[var(--fg-muted)]' : ''}`}>{LABEL[key]}</span>
                {!hasContent && (
                  <p className="text-xs text-[var(--fg-muted)] mt-0.5">{EMPTY_REASON[key]}</p>
                )}
              </div>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={!isHidden}
                  onChange={() => toggle(key)}
                  aria-label={`Mostrar ${LABEL[key]}`}
                />
                <span className="text-xs text-[var(--fg-muted)]">{isHidden ? 'Oculta' : 'Se muestra'}</span>
              </label>
            </li>
          )
        })}
      </ul>

      {/* The move/toggle result, announced. A visual reorder is invisible to a
          screen reader without this, and the buttons alone would just say
          "pressed". */}
      <p aria-live="polite" className="sr-only">{announcement}</p>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium"
      >
        {saving ? 'Guardando…' : 'Guardar secciones'}
      </button>

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}

/** The optional keys, in canonical order — exported for the tab's own spec. */
export const OPTIONAL_SECTION_KEYS = OPTIONAL_SECTIONS
