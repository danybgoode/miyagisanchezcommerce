/** Shared settings Toast — moved verbatim from the ShopSettings monolith. */

export interface ToastState {
  message: string
  type: 'success' | 'error'
}

export function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
        toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
      }`}
    >
      <span>{toast.type === 'success' ? '✓' : '⚠'}</span>
      <span>{toast.message}</span>
      <button onClick={onDismiss} className="ml-2 opacity-70 hover:opacity-100">×</button>
    </div>
  )
}
