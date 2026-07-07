'use client'

import { useRef, useImperativeHandle, forwardRef } from 'react'
import {
  type CustomFieldDef,
  type ArtworkFormat,
  ARTWORK_FORMATS,
  MAX_ARTWORK_SIZE_MB,
  effectiveMaxLength,
} from '@/lib/personalization'
import ArtworkFileInput from './ArtworkFileInput'

export interface PersonalizationFieldsHandle {
  /** Focus a field by id (used to land the buyer on the first missing required one). */
  focusField: (id: string) => void
}

/**
 * Controlled buy-box inputs for a listing's custom personalization fields.
 * Pure UI — the parent owns `values` and validation. Renders a live character
 * counter (AC 2.2) and a clear optional/required label; never shows an abrupt
 * red box (AC 2.2). The parent focuses the first missing required field via the
 * imperative handle (AC 2.3).
 *
 * The `file` case (custom-print-products S3) delegates its upload mechanics
 * entirely to `<ArtworkFileInput>` — this component stays network-unaware,
 * receiving the resulting R2 URL through the same `onChange(id, value)`
 * contract every other field type already uses.
 */
const PersonalizationFields = forwardRef<PersonalizationFieldsHandle, {
  defs: CustomFieldDef[]
  values: Record<string, string>
  onChange: (id: string, value: string) => void
  /** Field flagged as missing after a blocked submit — drives the gentle hint. */
  invalidFieldId?: string | null
  /** Required for any listing with a `file` field (the upload route needs it). */
  listingId?: string
  /** Physical print size in cm, if known — feeds the low-res preflight (S3.3);
   *  only the configurator context has this, so it's a no-op elsewhere. */
  physicalCm?: number | null
}>(function PersonalizationFields({ defs, values, onChange, invalidFieldId, listingId, physicalCm }, ref) {
  const refs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>>({})

  useImperativeHandle(ref, () => ({
    focusField(id: string) {
      const el = refs.current[id]
      if (el) {
        el.focus()
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    },
  }), [])

  if (defs.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
      {defs.map(def => {
        const value = values[def.id] ?? ''
        const max = effectiveMaxLength(def)
        const isMissing = invalidFieldId === def.id
        const baseBorder = isMissing ? '1.5px solid var(--warning)' : '1px solid var(--border)'
        const labelRow = (
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
            <label htmlFor={`pf_${def.id}`} style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>
              {def.label}
              {def.required
                ? <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span>
                : <span style={{ color: 'var(--fg-subtle)', fontWeight: 400, marginLeft: 6, fontSize: 12 }}>(opcional)</span>}
            </label>
            {def.type !== 'select' && def.type !== 'file' && (
              <span style={{ fontSize: 11, color: value.length >= max ? 'var(--warning)' : 'var(--fg-subtle)' }}>
                {value.length}/{max}
              </span>
            )}
          </div>
        )

        return (
          <div key={def.id}>
            {labelRow}
            {def.type === 'file' ? (
              <ArtworkFileInput
                fieldId={def.id}
                listingId={listingId ?? ''}
                allowedFormats={def.allowed_formats ?? [...ARTWORK_FORMATS] as ArtworkFormat[]}
                maxSizeMb={def.max_size_mb ?? MAX_ARTWORK_SIZE_MB}
                value={value}
                onChange={onChange}
                physicalCm={physicalCm}
              />
            ) : def.type === 'long_text' ? (
              <textarea
                id={`pf_${def.id}`}
                ref={el => { refs.current[def.id] = el }}
                value={value}
                onChange={e => onChange(def.id, e.target.value.slice(0, max))}
                maxLength={max}
                rows={3}
                placeholder={def.placeholder}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 'var(--r-md)',
                  border: baseBorder, background: 'var(--bg)', color: 'var(--fg)',
                  fontFamily: 'var(--font-sans)', fontSize: 14, resize: 'vertical',
                }}
              />
            ) : def.type === 'select' ? (
              <select
                id={`pf_${def.id}`}
                ref={el => { refs.current[def.id] = el }}
                value={value}
                onChange={e => onChange(def.id, e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 'var(--r-md)',
                  border: baseBorder, background: 'var(--bg)', color: value ? 'var(--fg)' : 'var(--fg-subtle)',
                  fontFamily: 'var(--font-sans)', fontSize: 14,
                }}
              >
                <option value="">{def.placeholder || 'Elige una opción…'}</option>
                {(def.options ?? []).map(opt => (
                  <option key={opt} value={opt} style={{ color: 'var(--fg)' }}>{opt}</option>
                ))}
              </select>
            ) : (
              <input
                id={`pf_${def.id}`}
                ref={el => { refs.current[def.id] = el }}
                type="text"
                value={value}
                onChange={e => onChange(def.id, e.target.value.slice(0, max))}
                maxLength={max}
                placeholder={def.placeholder}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 'var(--r-md)',
                  border: baseBorder, background: 'var(--bg)', color: 'var(--fg)',
                  fontFamily: 'var(--font-sans)', fontSize: 14,
                }}
              />
            )}
            {isMissing && (
              <p style={{ fontSize: 12, color: 'var(--warning)', marginTop: 4 }}>
                Completa este campo para continuar.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
})

export default PersonalizationFields
