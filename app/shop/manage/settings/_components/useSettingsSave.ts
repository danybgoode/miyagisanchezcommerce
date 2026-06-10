'use client'

/**
 * One hook that every extracted settings section uses to persist a slice of the
 * settings tree through the existing PATCH /api/sell/shop seam — so no section
 * re-touches persistence. The route deep-merges the `settings` override into the
 * stored tree, so a section sending ONLY its own block never clobbers siblings.
 *
 * Toast copy + timing are byte-for-byte what the monolith's handleSave does
 * today ('Cambios guardados correctamente.' / 'Error al guardar.' /
 * 'Sin conexión. Inténtalo de nuevo.'; 4s auto-dismiss).
 */

import { useState, useCallback } from 'react'
import type { ToastState } from './Toast'

interface SaveOptions {
  /** Called when the API returns a 422 naming a specific field. */
  onFieldError?: (field: string, message: string) => void
  /** Called with the parsed response body on success (e.g. to read support_product_id). */
  onSuccess?: (data: Record<string, unknown>) => void
}

export function useSettingsSave() {
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  const markDirty = useCallback(() => setIsDirty(true), [])
  const dismissToast = useCallback(() => setToast(null), [])

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  /**
   * PATCH a partial shop payload. Returns true on success. `payload` is the
   * same body shape the monolith posts (top-level profile fields +
   * `settings: { … }`); a section passes only the keys it owns.
   */
  const save = useCallback(
    async (payload: Record<string, unknown>, opts?: SaveOptions): Promise<boolean> => {
      setSaving(true)
      try {
        const res = await fetch('/api/sell/shop', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string; field?: string }
        if (!res.ok) {
          if (data.field) opts?.onFieldError?.(data.field, data.error ?? 'Error.')
          else showToast(data.error ?? 'Error al guardar.', 'error')
          return false
        }
        opts?.onSuccess?.(data as Record<string, unknown>)
        showToast('Cambios guardados correctamente.', 'success')
        setIsDirty(false)
        return true
      } catch {
        showToast('Sin conexión. Inténtalo de nuevo.', 'error')
        return false
      } finally {
        setSaving(false)
      }
    },
    [showToast],
  )

  return { save, saving, toast, showToast, dismissToast, isDirty, markDirty, setIsDirty }
}
