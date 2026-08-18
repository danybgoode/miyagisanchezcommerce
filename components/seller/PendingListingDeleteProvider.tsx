'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Toast, useToast, type ToastVariant } from '@/components/feedback/Toast'
import {
  EMPTY_PENDING_LISTING_DELETE,
  LISTING_DELETE_UNDO_MS,
  pendingListingDeleteReducer,
} from '@/lib/pending-listing-delete'

type CommitResult = { ok: boolean; message?: string; toastType?: ToastVariant }

export type PendingDeleteRequest = {
  ids: string[]
  label: string
  commit: () => Promise<CommitResult>
  onSuccess?: () => void
}

type PendingDeleteContextValue = {
  pendingIds: ReadonlySet<string>
  hasPendingDelete: boolean
  scheduleDelete: (request: PendingDeleteRequest) => boolean
}

const PendingDeleteContext = createContext<PendingDeleteContextValue | null>(null)

export function PendingListingDeleteProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [state, dispatch] = useReducer(pendingListingDeleteReducer, EMPTY_PENDING_LISTING_DELETE)
  const { toast, showToast, dismissToast } = useToast(LISTING_DELETE_UNDO_MS)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeRef = useRef<PendingDeleteRequest | null>(null)

  const undo = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    activeRef.current = null
    dispatch({ type: 'undo' })
  }, [])

  const scheduleDelete = useCallback((request: PendingDeleteRequest) => {
    if (activeRef.current || request.ids.length === 0) return false
    activeRef.current = request
    dispatch({ type: 'schedule', ids: request.ids, label: request.label })
    showToast(
      `${request.label} se eliminará en 10 segundos.`,
      'success',
      { label: 'Deshacer', onClick: undo },
    )
    timerRef.current = setTimeout(async () => {
      timerRef.current = null
      dispatch({ type: 'expire' })
      const active = activeRef.current
      if (!active) return
      let result: CommitResult
      try {
        result = await active.commit()
      } catch {
        result = { ok: false, message: 'Sin conexión. El anuncio no se eliminó.' }
      }
      if (result.ok) active.onSuccess?.()
      activeRef.current = null
      dispatch({ type: 'settle' })
      showToast(
        result.message ?? (result.ok ? 'Eliminación completada.' : 'No se pudo eliminar. Inténtalo de nuevo.'),
        result.toastType ?? (result.ok ? 'success' : 'error'),
      )
      router.refresh()
    }, LISTING_DELETE_UNDO_MS)
    return true
  }, [router, showToast, undo])

  // Reloading or leaving the seller shell cancels a not-yet-committed delete.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    activeRef.current = null
  }, [])

  const value = useMemo<PendingDeleteContextValue>(() => ({
    pendingIds: new Set(state.ids),
    hasPendingDelete: state.phase !== 'idle',
    scheduleDelete,
  }), [scheduleDelete, state.ids, state.phase])

  return (
    <PendingDeleteContext.Provider value={value}>
      {children}
      <Toast toast={toast} onDismiss={dismissToast} />
    </PendingDeleteContext.Provider>
  )
}

export function usePendingListingDelete(): PendingDeleteContextValue {
  const value = useContext(PendingDeleteContext)
  if (!value) throw new Error('usePendingListingDelete must be used inside PendingListingDeleteProvider')
  return value
}
