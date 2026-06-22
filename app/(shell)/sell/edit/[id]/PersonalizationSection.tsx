'use client'

import {
  type CustomFieldDef,
  type CustomFieldType,
  CUSTOM_FIELD_TYPES,
  FIELD_TYPE_LABELS,
  MAX_CUSTOM_FIELDS,
  emptyFieldDef,
  typeCap,
} from '@/lib/personalization'

/**
 * Seller-facing editor for a listing's custom personalization fields.
 * Fully controlled — state lives in EditForm; this only renders + emits changes.
 */
export default function PersonalizationSection({
  fields,
  setFields,
}: {
  fields: CustomFieldDef[]
  setFields: (next: CustomFieldDef[]) => void
}) {
  function update(id: string, patch: Partial<CustomFieldDef>) {
    setFields(fields.map(f => (f.id === id ? { ...f, ...patch } : f)))
  }
  function remove(id: string) {
    setFields(fields.filter(f => f.id !== id))
  }
  function move(id: string, dir: -1 | 1) {
    const i = fields.findIndex(f => f.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= fields.length) return
    const next = [...fields]
    ;[next[i], next[j]] = [next[j], next[i]]
    setFields(next)
  }
  function add() {
    if (fields.length >= MAX_CUSTOM_FIELDS) return
    setFields([...fields, emptyFieldDef('short_text')])
  }
  function changeType(id: string, type: CustomFieldType) {
    const patch: Partial<CustomFieldDef> = { type }
    // keep options only for select; reset max_length so the new cap applies cleanly
    if (type === 'select') patch.options = fields.find(f => f.id === id)?.options ?? []
    else patch.options = undefined
    patch.max_length = undefined
    update(id, patch)
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-2 mb-1">
        <label className="block text-sm font-medium text-[var(--color-text)]">
          Personalización del producto
        </label>
        <span className="text-xs text-[var(--color-muted)]">{fields.length}/{MAX_CUSTOM_FIELDS}</span>
      </div>
      <p className="text-xs text-[var(--color-muted)] mb-3">
        Pide datos al comprador antes de pagar — un nombre para grabar, un mensaje de regalo, una
        talla. Lo que escriba viajará con el pedido hasta tu pantalla de pedidos.
      </p>

      {fields.length === 0 && (
        <div className="border border-dashed border-[var(--color-border)] rounded-lg px-4 py-5 text-center mb-3">
          <p className="text-sm text-[var(--color-muted)]">Sin campos de personalización.</p>
        </div>
      )}

      <div className="space-y-3">
        {fields.map((field, idx) => (
          <div
            key={field.id}
            className="border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-background)]"
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-medium text-[var(--color-muted)]">Campo {idx + 1}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(field.id, -1)}
                  disabled={idx === 0}
                  aria-label="Subir"
                  className="text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-30 px-1"
                >↑</button>
                <button
                  type="button"
                  onClick={() => move(field.id, 1)}
                  disabled={idx === fields.length - 1}
                  aria-label="Bajar"
                  className="text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-30 px-1"
                >↓</button>
                <button
                  type="button"
                  onClick={() => remove(field.id)}
                  aria-label="Eliminar campo"
                  className="text-red-500 hover:text-red-600 px-1"
                >✕</button>
              </div>
            </div>

            {/* Label + type */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
              <input
                type="text"
                value={field.label}
                onChange={e => update(field.id, { label: e.target.value })}
                maxLength={60}
                placeholder="Etiqueta (p. ej. Nombre a grabar)"
                className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
              />
              <select
                value={field.type}
                onChange={e => changeType(field.id, e.target.value as CustomFieldType)}
                className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
              >
                {CUSTOM_FIELD_TYPES.map(t => (
                  <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>

            {/* Placeholder (text types) */}
            {field.type !== 'select' && (
              <input
                type="text"
                value={field.placeholder ?? ''}
                onChange={e => update(field.id, { placeholder: e.target.value })}
                maxLength={100}
                placeholder="Texto de ayuda (p. ej. Hasta 15 caracteres)"
                className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
              />
            )}

            {/* Options (select) */}
            {field.type === 'select' && (
              <OptionsEditor
                options={field.options ?? []}
                onChange={options => update(field.id, { options })}
              />
            )}

            {/* Max length (text types) + required */}
            <div className="flex items-center justify-between gap-3 mt-1">
              {field.type !== 'select' ? (
                <label className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                  Máx. caracteres
                  <input
                    type="number"
                    min={1}
                    max={typeCap(field.type)}
                    inputMode="numeric"
                    value={field.max_length ?? ''}
                    onChange={e => {
                      const n = parseInt(e.target.value, 10)
                      update(field.id, { max_length: Number.isFinite(n) && n > 0 ? n : undefined })
                    }}
                    placeholder={String(typeCap(field.type))}
                    className="w-20 border border-[var(--color-border)] rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
                  />
                </label>
              ) : <span />}
              <label className="flex items-center gap-2 text-xs text-[var(--color-text)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={e => update(field.id, { required: e.target.checked })}
                  className="accent-[var(--color-accent)]"
                />
                Obligatorio
              </label>
            </div>
          </div>
        ))}
      </div>

      {fields.length < MAX_CUSTOM_FIELDS && (
        <button
          type="button"
          onClick={add}
          className="mt-3 text-sm font-medium text-[var(--color-accent)] hover:underline"
        >
          + Agregar campo de personalización
        </button>
      )}
    </div>
  )
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <div className="mb-2">
      <p className="text-xs text-[var(--color-muted)] mb-1">Opciones</p>
      <div className="space-y-1.5">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={opt}
              onChange={e => {
                const next = [...options]
                next[i] = e.target.value
                onChange(next)
              }}
              maxLength={60}
              placeholder={`Opción ${i + 1}`}
              className="flex-1 border border-[var(--color-border)] rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
            />
            <button
              type="button"
              onClick={() => onChange(options.filter((_, j) => j !== i))}
              aria-label="Quitar opción"
              className="text-red-500 hover:text-red-600 px-1"
            >✕</button>
          </div>
        ))}
      </div>
      {options.length < 20 && (
        <button
          type="button"
          onClick={() => onChange([...options, ''])}
          className="mt-1.5 text-xs font-medium text-[var(--color-accent)] hover:underline"
        >
          + Agregar opción
        </button>
      )}
    </div>
  )
}
