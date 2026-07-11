'use client'

/**
 * Perfil de tienda — name, description, location. Extracted verbatim from the
 * ShopSettings monolith's `#perfil` section. Behavior-preserving: persists only
 * the top-level profile fields it owns ({name, description, state, city}) through
 * useSettingsSave() → PATCH /api/sell/shop (the route joins city+state into
 * `location` and only touches fields present in the body, so siblings — incl.
 * the logo managed under Diseño — are untouched).
 *
 * The logo & banner live in the Apariencia/Diseño section in the canonical
 * taxonomy, matching the monolith's section layout.
 */

import { useState } from 'react'
import { useSettingsSave } from '../_components/useSettingsSave'
import { Toast } from '@/components/feedback/Toast'
import { SectionTitle } from '../_components/SectionTitle'
import { SectionSaveBar } from '../_components/SectionSaveBar'
import { CopyPromptButton } from '../_components/CopyPromptButton'
import { parseLocation } from '@/lib/shop-settings/helpers'
import { MAJOR_MEXICAN_CITIES, CITIES_BY_STATE } from '@/lib/types'
import { ESTADOS } from '@/lib/mx-locations'

export interface PerfilInitial {
  name: string
  description: string
  location: string | null
}

export default function Perfil({ initial }: { initial: PerfilInitial }) {
  const { save, saving, toast, dismissToast, isDirty, markDirty } = useSettingsSave()
  const mark = markDirty

  const parsedLoc = parseLocation(initial.location)
  const [name, setName]               = useState(initial.name)
  const [description, setDescription] = useState(initial.description ?? '')
  const [city, setCity]               = useState(parsedLoc.city)
  const [state, setState]             = useState(parsedLoc.state)
  const [isCityOther, setIsCityOther] = useState(() => {
    const citiesForState = parsedLoc.state ? CITIES_BY_STATE[parsedLoc.state] : undefined
    return citiesForState
      ? parsedLoc.city !== '' && !citiesForState.includes(parsedLoc.city)
      : false
  })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  async function handleSave() {
    const errors: Record<string, string> = {}
    if (name.trim().length < 2)   errors.name = 'El nombre debe tener al menos 2 caracteres.'
    if (description.length > 500) errors.description = 'Máximo 500 caracteres.'
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return }
    setFieldErrors({})
    await save(
      {
        name:        name.trim(),
        description: description.trim(),
        state:       state.trim(),
        city:        city.trim(),
      },
      { onFieldError: (field, message) => setFieldErrors({ [field]: message }) },
    )
  }

  return (
    <div>
      <section id="perfil" className="border border-[var(--color-border)] rounded-[var(--r-lg)] p-5 mb-5">
        <SectionTitle>Perfil de tienda</SectionTitle>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Nombre de tienda <span className="text-[var(--danger)]">*</span>
            </label>
            <input
              value={name}
              onChange={e => { setName(e.target.value); mark(); setFieldErrors(p => ({ ...p, name: '' })) }}
              maxLength={80}
              className="w-full border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              placeholder="Mi tienda"
            />
            {fieldErrors.name && <p className="text-[var(--danger)] text-xs mt-1">⚠ {fieldErrors.name}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium">
                Descripción
                <span className={`ml-2 text-xs font-normal ${description.length > 450 ? 'text-[var(--warning)]' : 'text-[var(--color-muted)]'}`}>
                  {description.length}/500
                </span>
              </label>
              <CopyPromptButton prompt={`Ayúdame a escribir una descripción de 2-3 oraciones para mi tienda en línea en México llamada "${name || 'mi tienda'}". La descripción debe aparecer en mi página pública y transmitir confianza a compradores mexicanos. Máximo 500 caracteres, en español. ${description ? `Mejora esta versión: "${description}"` : 'Mi tienda vende:'}`} />
            </div>
            <textarea
              value={description}
              onChange={e => { setDescription(e.target.value); mark(); setFieldErrors(p => ({ ...p, description: '' })) }}
              maxLength={500}
              rows={3}
              className="w-full border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] resize-none"
              placeholder="Cuéntanos sobre tu tienda…"
            />
            {fieldErrors.description && <p className="text-[var(--danger)] text-xs mt-1">⚠ {fieldErrors.description}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Estado / State</label>
              <select
                value={state}
                onChange={e => {
                  const newState = e.target.value
                  setState(newState)
                  setCity('')
                  setIsCityOther(false)
                  mark()
                }}
                className="w-full border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] bg-[var(--bg-elevated)]"
              >
                <option value="">Selecciona estado</option>
                {ESTADOS.map(e => <option key={e.inegi_code} value={e.name}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Ciudad / Municipio</label>
              {isCityOther ? (
                <div className="space-y-1.5">
                  <input
                    value={city}
                    onChange={e => { setCity(e.target.value); mark() }}
                    placeholder="Escribe tu ciudad"
                    className="w-full border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => { setCity(''); setIsCityOther(false); mark() }}
                    className="text-xs text-[var(--color-accent)] hover:underline"
                  >
                    ← Seleccionar de la lista
                  </button>
                </div>
              ) : (
                <select
                  value={city}
                  onChange={e => {
                    const v = e.target.value
                    if (v === '__other__') {
                      setCity('')
                      setIsCityOther(true)
                    } else {
                      setCity(v)
                    }
                    mark()
                  }}
                  className="w-full border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] bg-[var(--bg-elevated)]"
                >
                  <option value="">{state ? 'Selecciona ciudad' : 'Primero elige estado'}</option>
                  {(state ? CITIES_BY_STATE[state] ?? [] : MAJOR_MEXICAN_CITIES).map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                  <option value="__other__">Mi ciudad no aparece en la lista…</option>
                </select>
              )}
            </div>
          </div>
        </div>
      </section>

      <SectionSaveBar saving={saving} isDirty={isDirty} onSave={handleSave} />

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  )
}
