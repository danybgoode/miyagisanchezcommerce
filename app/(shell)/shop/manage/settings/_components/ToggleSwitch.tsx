/** Shared settings toggle — moved verbatim from the ShopSettings monolith. */

export function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}) {
  return (
    <label className={`flex items-center justify-between gap-4 py-3 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
      <div>
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-xs text-[var(--color-muted)]">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-[var(--r-pill)] border-2 border-transparent transition-colors focus:outline-none ${
          checked ? 'bg-[var(--color-accent)]' : 'bg-gray-300'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 rounded-[var(--r-pill)] bg-[var(--bg-elevated)] shadow transform transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  )
}
