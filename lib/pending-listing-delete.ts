export const LISTING_DELETE_UNDO_MS = 10_000

export type PendingListingDeleteState =
  | { phase: 'idle'; ids: string[]; label: null }
  | { phase: 'waiting' | 'committing'; ids: string[]; label: string }

export type PendingListingDeleteAction =
  | { type: 'schedule'; ids: string[]; label: string }
  | { type: 'undo' }
  | { type: 'expire' }
  | { type: 'settle' }

export const EMPTY_PENDING_LISTING_DELETE: PendingListingDeleteState = {
  phase: 'idle',
  ids: [],
  label: null,
}

/** Pure state seam: no request can start before the explicit `expire` event. */
export function pendingListingDeleteReducer(
  state: PendingListingDeleteState,
  action: PendingListingDeleteAction,
): PendingListingDeleteState {
  if (action.type === 'schedule') {
    if (state.phase !== 'idle' || action.ids.length === 0) return state
    return { phase: 'waiting', ids: [...new Set(action.ids)], label: action.label }
  }
  if (action.type === 'undo' || action.type === 'settle') return EMPTY_PENDING_LISTING_DELETE
  if (action.type === 'expire' && state.phase === 'waiting') return { ...state, phase: 'committing' }
  return state
}
