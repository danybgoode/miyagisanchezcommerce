'use client'

/**
 * Promoter Program (epic 08, Sprint 2) — the custom-domain payment-cadence picker.
 * Presentational + controlled (state lives in Canal.tsx): `recurring` (annual
 * subscription that renews) or `one_time` (pay a year up front, no renewal — the
 * cash-friendly option). Extracted from Canal.tsx so the section stays under the
 * anti-monolith line cap. Render it inside the custom-domain upsell block.
 */
export type DomainCadenceChoice = 'recurring' | 'one_time'

export default function DomainCadenceField({
  value,
  onChange,
  onInteract,
}: {
  value: DomainCadenceChoice
  onChange: (cadence: DomainCadenceChoice) => void
  /** Fired on any interaction (e.g. to clear a stale error). */
  onInteract?: () => void
}) {
  const pick = (c: DomainCadenceChoice) => { onChange(c); onInteract?.() }
  return (
    <fieldset className="mb-3">
      <legend className="block text-[11px] font-medium text-[var(--color-muted)] mb-1.5">
        Forma de pago
      </legend>
      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="radio"
            name="domain-cadence"
            checked={value === 'recurring'}
            onChange={() => pick('recurring')}
          />
          <span>Suscripción anual <span className="text-[var(--color-muted)]">(se renueva cada año)</span></span>
        </label>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="radio"
            name="domain-cadence"
            checked={value === 'one_time'}
            onChange={() => pick('one_time')}
          />
          <span>Pagar un año <span className="text-[var(--color-muted)]">(pago único, sin renovación)</span></span>
        </label>
      </div>
    </fieldset>
  )
}
