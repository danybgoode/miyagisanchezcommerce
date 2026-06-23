'use client'

/**
 * The shared save footer every extracted settings section renders: a "Volver al
 * panel" link + "Guardar cambios" button, plus the sticky "unsaved changes" bar
 * that appears once the section is dirty. Lifted verbatim from the monolith's
 * per-section footer so each section's save UX is byte-for-byte identical and
 * can't drift across the 7 sections.
 */

export function SectionSaveBar({
  saving,
  isDirty,
  onSave,
}: {
  saving: boolean
  isDirty: boolean
  onSave: () => void
}) {
  return (
    <>
      {/* ── Save button ───────────────────────────────────────────────────── */}
      {/* The top-of-page breadcrumb (<SellerBreadcrumb>) now owns the back affordance. */}
      <div className="flex items-center justify-end mb-24">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="bg-[var(--color-accent)] text-white px-6 py-2.5 rounded-lg font-semibold text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors"
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>

      {/* ── Sticky unsaved bar ────────────────────────────────────────────────── */}
      {isDirty && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[var(--color-border)] shadow-lg">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
              <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
              Tienes cambios sin guardar
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="text-sm text-[var(--color-muted)] hover:text-[var(--color-foreground)] px-3 py-1.5 border border-[var(--color-border)] rounded-lg transition-colors"
              >
                Descartar
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={saving}
                className="bg-[var(--color-accent)] text-white px-5 py-1.5 rounded-lg font-semibold text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors"
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
