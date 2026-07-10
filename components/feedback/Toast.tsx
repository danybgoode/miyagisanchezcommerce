'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Toast — seller-portal-rails-foundation S1 · Story 1.2 (R6 "after" + R7 undo).
 * The ONE toast primitive — only `components/feedback/` may render one (rail R6).
 * `useToast()` centralizes the state+auto-dismiss+undo shape that used to be
 * copy-pasted across CatalogTable/OrderDetail/settings' bespoke toasts.
 */

export type ToastVariant = 'success' | 'error'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastState {
  message: string
  type: ToastVariant
  action?: ToastAction
}

const ICON: Record<ToastVariant, string> = {
  success: 'iconoir-check-circle',
  error: 'iconoir-warning-triangle',
}

export function useToast(durationMs = 4000) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismissToast = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast(null)
  }, [])

  const showToast = useCallback(
    (message: string, type: ToastVariant, action?: ToastAction) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      setToast({ message, type, action })
      timerRef.current = setTimeout(() => setToast(null), durationMs)
    },
    [durationMs],
  )

  // Clear the pending auto-dismiss timer if the host unmounts mid-toast —
  // otherwise it fires setState on an unmounted component.
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  return { toast, showToast, dismissToast }
}

export function Toast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  if (!toast) return null
  const isSuccess = toast.type === 'success'
  return (
    <div
      role="status"
      aria-live="polite"
      className="toast-in fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-[var(--r-md)] px-4 py-3 text-sm font-medium shadow-[var(--shadow-3)]"
      style={{
        background: isSuccess ? 'var(--success)' : 'var(--danger)',
        color: 'var(--fg-inverse)',
      }}
    >
      <i className={ICON[toast.type]} aria-hidden="true" />
      <span>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick()
            onDismiss()
          }}
          className="font-semibold underline underline-offset-2 opacity-90 hover:opacity-100"
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" onClick={onDismiss} aria-label="Cerrar" className="ml-1 opacity-70 hover:opacity-100">
        <i className="iconoir-xmark" aria-hidden="true" />
      </button>
    </div>
  )
}
