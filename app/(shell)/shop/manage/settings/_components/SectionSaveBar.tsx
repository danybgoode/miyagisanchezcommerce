'use client'

/**
 * The shared save footer every extracted settings section renders: a "Volver al
 * panel" link + "Guardar cambios" button, plus the sticky "unsaved changes" bar
 * that appears once the section is dirty. Lifted verbatim from the monolith's
 * per-section footer so each section's save UX is byte-for-byte identical and
 * can't drift across the 7 sections.
 */

import { Button } from '@/components/ui/Button'

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
        <Button type="button" variant="primary" onClick={onSave} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </div>

      {/* ── Sticky unsaved bar ────────────────────────────────────────────────── */}
      {isDirty && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-[var(--bg-elevated)] border-t border-[var(--color-border)] shadow-lg">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
              <span className="w-2 h-2 rounded-[var(--r-pill)] bg-[var(--warning)] flex-shrink-0" />
              Tienes cambios sin guardar
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => window.location.reload()}>
                Descartar
              </Button>
              <Button type="button" variant="primary" size="sm" onClick={onSave} disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
