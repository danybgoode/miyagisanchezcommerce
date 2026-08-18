'use client'

/**
 * Living Shop — the theme picker and Custom controls (epic 07, Story 5.4).
 *
 * Three large choices; the Custom controls appear only once Custom is selected,
 * so a merchant who wants a finished look never sees twelve dropdowns.
 *
 * Labels are PLAIN LANGUAGE, not CSS vocabulary: "Bordes" not "border-radius",
 * "Aire entre las cosas" not "density". A merchant is choosing how their shop
 * feels, not writing a stylesheet — and if they had to know the CSS word for it,
 * the schema would not have bought them anything over a code editor.
 */

import { useState } from 'react'
import { Toast, useToast } from '@/components/feedback/Toast'
import { THEME_ENUMS, DEFAULT_RECIPE, isSafeColor } from '@/lib/shop-presentation/theme'
import { CORE_ACCENT } from '@/lib/platform-theme'
import type { ThemeMode, ThemeRecipe } from '@/lib/shop-presentation/types'

const MODES: Array<{ key: ThemeMode; label: string; description: string }> = [
  { key: 'default', label: 'Clásico', description: 'Limpio y directo. El producto manda.' },
  { key: 'retro', label: 'Retro Social', description: 'Marcos, bordes y perfil — como las páginas de antes.' },
  { key: 'custom', label: 'A tu manera', description: 'Tú eliges tipografía, colores, bordes y ritmo.' },
]

/** Plain-language label + option names for each axis. No CSS words. */
const CONTROLS: Array<{
  field: keyof typeof THEME_ENUMS
  label: string
  help?: string
  options: Record<string, string>
}> = [
  { field: 'typography', label: 'Tipografía', options: {
    sistema: 'Del sistema', editorial: 'Editorial', tecnica: 'Técnica', manuscrita: 'Redondeada', geometrica: 'Geométrica' } },
  { field: 'density', label: 'Aire entre las cosas', options: {
    compact: 'Apretado', balanced: 'Equilibrado', airy: 'Espacioso' } },
  { field: 'corners', label: 'Esquinas', options: {
    square: 'Rectas', soft: 'Suaves', round: 'Muy redondeadas' } },
  { field: 'surface', label: 'Tarjetas', options: {
    flat: 'Sin borde', bordered: 'Con borde', elevated: 'Con sombra' } },
  { field: 'background', label: 'Fondo', options: {
    plain: 'Liso', tinted: 'Con tu color', paper: 'Papel', grid: 'Cuadrícula', dots: 'Puntos' } },
  { field: 'hero', label: 'Portada', options: {
    none: 'Sin portada', compact: 'Discreta', feature: 'Grande' } },
  { field: 'wall_layout', label: 'Muro', help: 'En celular siempre se ve en una columna.', options: {
    single: 'Una columna', 'feed-sidebar': 'Con columna lateral' } },
  { field: 'wall_card', label: 'Publicaciones', options: {
    quiet: 'Discretas', framed: 'Enmarcadas', editorial: 'Editoriales' } },
  { field: 'product_card', label: 'Productos', options: {
    quiet: 'Discretos', framed: 'Enmarcados', tile: 'Mosaico' } },
  { field: 'identity', label: 'Tu identidad', help: 'Qué tanto pesa tu nombre y tu logo arriba.', options: {
    compact: 'Discreta', standard: 'Normal', prominent: 'Protagonista' } },
]

export default function ThemeTab({
  mode,
  recipe,
  onModeChange,
  onRecipeChange,
}: {
  mode: ThemeMode
  recipe: ThemeRecipe
  onModeChange: (next: ThemeMode) => void
  onRecipeChange: (next: ThemeRecipe) => void
}) {
  const [saving, setSaving] = useState(false)
  const { toast, showToast, dismissToast } = useToast()

  // Inline reason, shown before save rather than after: a colour the API would
  // refuse should never look accepted in the editor.
  const colorIssue = (value: string | null) =>
    value !== null && !isSafeColor(value) ? 'Usa un color en formato #rrggbb.' : null

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/sell/shop', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            theme_mode: mode,
            // Only Custom persists a recipe: Default and Retro are finished
            // themes and a stored recipe under them would be dead state that
            // reappears if the seller ever switches back.
            ...(mode === 'custom' ? { theme_recipe: recipe } : {}),
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { showToast(data.error ?? 'No se pudo guardar.', 'error'); return }
      showToast('Guardado.', 'success')
    } catch {
      showToast('Sin conexión. Intenta de nuevo.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <fieldset className="mb-6">
        <legend className="text-sm font-medium mb-2">¿Cómo se ve tu tienda?</legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => onModeChange(m.key)}
              aria-pressed={mode === m.key}
              className={`text-left p-3 rounded-xl border transition-colors ${
                mode === m.key ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)]'
              }`}
            >
              <span className="font-medium block">{m.label}</span>
              <span className="text-xs text-[var(--fg-muted)]">{m.description}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {mode === 'custom' && (
        <div className="space-y-4 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CONTROLS.map((control) => (
              <div key={control.field}>
                <label htmlFor={`theme-${control.field}`} className="text-sm font-medium block mb-1">
                  {control.label}
                </label>
                <select
                  id={`theme-${control.field}`}
                  value={recipe[control.field] as string}
                  onChange={(e) => onRecipeChange({ ...recipe, [control.field]: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
                >
                  {THEME_ENUMS[control.field].map((option) => (
                    <option key={option} value={option}>{control.options[option] ?? option}</option>
                  ))}
                </select>
                {control.help && <p className="text-xs text-[var(--fg-muted)] mt-1">{control.help}</p>}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([['accent', 'Color principal'], ['secondary_accent', 'Color secundario']] as const).map(([field, label]) => {
              const issue = colorIssue(recipe[field])
              return (
                <div key={field}>
                  <label htmlFor={`theme-${field}`} className="text-sm font-medium block mb-1">{label}</label>
                  <div className="flex items-center gap-2">
                    <input
                      id={`theme-${field}`}
                      type="color"
                      value={recipe[field] ?? CORE_ACCENT}
                      onChange={(e) => onRecipeChange({ ...recipe, [field]: e.target.value })}
                      className="h-9 w-14 rounded border border-[var(--border)]"
                    />
                    <button
                      type="button"
                      onClick={() => onRecipeChange({ ...recipe, [field]: null })}
                      className="text-xs px-2 py-1 rounded border border-[var(--border)]"
                    >
                      Usar el de mi marca
                    </button>
                  </div>
                  {issue && <p role="alert" className="text-xs text-red-600 mt-1">{issue}</p>}
                </div>
              )
            })}
          </div>

          {/* Reset is explicit and reversible BEFORE save — it only touches local
              state, so a merchant can undo it by leaving without saving. */}
          <button
            type="button"
            onClick={() => onRecipeChange({ ...DEFAULT_RECIPE })}
            className="text-sm px-3 py-2 rounded-lg border border-[var(--border)]"
          >
            Volver a los valores de fábrica
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium"
      >
        {saving ? 'Guardando…' : 'Guardar el tema'}
      </button>

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}
