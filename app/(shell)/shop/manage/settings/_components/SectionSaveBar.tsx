'use client'

/**
 * The shared save footer every extracted settings section renders: a "Volver al
 * panel" link + "Guardar cambios" button, plus the sticky "unsaved changes" bar
 * that appears once the section is dirty. Lifted verbatim from the monolith's
 * per-section footer so each section's save UX is byte-for-byte identical and
 * can't drift across the 7 sections.
 */

import Link from 'next/link'

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
      <div className="flex items-center justify-between mb-24">
        <Link href="/shop/manage" className="text-sm text-[var(--color-muted)] hover:text-[var(--color-foreground)] no-underline">
          ← Volver al panel
        </Link>
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
