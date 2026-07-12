'use client'

import { useEffect, useRef, useState } from 'react'
import { slugify, validateSlug } from '@/lib/slug'

export type SlugStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid'

/**
 * Reusable slug picker for the shop URL (miyagisanchez.com/s/[slug]).
 * Shows the URL prefix, validates format/reserved locally (instant), then
 * debounced-checks availability against /api/sell/shop/slug/check with a ✓/✗.
 * Reports status up via `onStatusChange` so the parent can gate submit.
 *
 * Used at shop creation (US-2) and in settings (US-3).
 */
export function SlugField({
  value,
  onChange,
  currentSlug,
  onStatusChange,
  label = 'URL de tu tienda',
  disabled = false,
  autoFocus = false,
  prefix = 'miyagisanchez.com/s/',
  checkUrl = '/api/sell/shop/slug/check',
  placeholder = 'mi-tienda',
  successText = '¡Disponible! Tu tienda vivirá en esta URL.',
}: {
  value: string
  onChange: (v: string) => void
  /** The seller's existing slug — always reported available (re-saving it is fine). */
  currentSlug?: string
  onStatusChange?: (s: SlugStatus) => void
  label?: string
  disabled?: boolean
  autoFocus?: boolean
  /** URL prefix shown before the input (e.g. 'mschz.org/'). */
  prefix?: string
  /** Availability endpoint; receives `?slug=`. Returns `{ available, reason? }`. */
  checkUrl?: string
  placeholder?: string
  successText?: string
}) {
  const [status, setStatus] = useState<SlugStatus>('idle')
  const [reason, setReason] = useState<string | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  function setBoth(s: SlugStatus, r: string | null) {
    setStatus(s); setReason(r); onStatusChange?.(s)
  }

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)

    const slug = value.trim().toLowerCase()
    if (!slug) { setBoth('idle', null); return }
    if (currentSlug && slug === currentSlug) { setBoth('available', null); return }

    // Instant local validation before any network round-trip.
    const local = validateSlug(slug)
    if (!local.valid) { setBoth('invalid', local.reason); return }

    setBoth('checking', null)
    debounce.current = setTimeout(async () => {
      try {
        const sep = checkUrl.includes('?') ? '&' : '?'
        const res = await fetch(`${checkUrl}${sep}slug=${encodeURIComponent(slug)}`)
        const data = await res.json() as { available?: boolean; reason?: string }
        if (data.available) setBoth('available', null)
        else setBoth('taken', data.reason ?? 'No disponible.')
      } catch {
        setBoth('idle', 'No pudimos verificar. Intenta de nuevo.')
      }
    }, 300)

    return () => { if (debounce.current) clearTimeout(debounce.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, currentSlug])

  const borderClass =
    status === 'available' ? 'border-green-400'
    : status === 'taken' || status === 'invalid' ? 'border-red-400'
    : 'border-[var(--color-border)]'

  return (
    <div>
      <label className="block text-sm font-medium text-[var(--color-fg)] mb-1">{label}</label>
      <div className={`flex items-stretch border rounded overflow-hidden bg-white focus-within:ring-2 focus-within:ring-[var(--color-accent)] ${borderClass}`}>
        <span className="px-3 py-2.5 text-xs sm:text-sm text-[var(--color-muted)] bg-[var(--color-bg-subtle,#f5f5f5)] border-r border-[var(--color-border)] font-mono whitespace-nowrap self-center">
          {prefix}
        </span>
        <input
          type="text"
          value={value}
          onChange={e => onChange(slugify(e.target.value))}
          maxLength={40}
          disabled={disabled}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label="slug"
          className="flex-1 min-w-0 px-3 py-2.5 text-sm font-mono bg-transparent focus:outline-none disabled:opacity-60"
        />
        <span className="px-3 self-center text-sm" aria-hidden>
          {status === 'checking' && <span className="text-[var(--color-muted)]">…</span>}
          {status === 'available' && <i className="iconoir-check text-green-600" aria-hidden />}
          {(status === 'taken' || status === 'invalid') && <i className="iconoir-xmark text-red-500" aria-hidden />}
        </span>
      </div>
      {reason && <p className="text-xs text-red-600 mt-1">{reason}</p>}
      {status === 'available' && value && (
        <p className="text-xs text-green-700 mt-1">{successText}</p>
      )}
    </div>
  )
}
