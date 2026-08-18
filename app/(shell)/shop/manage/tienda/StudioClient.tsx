'use client'

/**
 * Living Shop — the studio shell (epic 07).
 *
 * Sprint 1 lands the Wall tab, because authoring has to exist the moment
 * persistence does — a table nobody can write to is not a shipped slice.
 * Secciones · Tema · Marca · Vista previa join it in Sprints 3–5; the tab list
 * grows, the shell does not.
 *
 * The shell owns ONLY tab state. Each tab owns its own persistence, so nothing
 * here becomes a controller for the whole page — that is how `Diseno.tsx`'s
 * predecessor reached 4,076 lines.
 */

import { useState } from 'react'
import WallTab from './WallTab'
import type { StudioObjects, StudioShop, StudioTab } from './types'
import type { WallEntry } from '@/lib/wall/types'

const TABS: Array<{ key: StudioTab; label: string; icon: string }> = [
  { key: 'wall', label: 'Muro', icon: 'iconoir-post' },
]

export default function StudioClient({
  shop,
  initialEntries,
  objects,
}: {
  shop: StudioShop
  initialEntries: WallEntry[]
  objects: StudioObjects
  settings: Record<string, unknown>
}) {
  const [tab, setTab] = useState<StudioTab>('wall')

  return (
    <div className="max-w-5xl mx-auto px-4 pb-16">
      <header className="pt-2 pb-5">
        <h1 className="text-2xl font-bold">Apariencia y contenido</h1>
        <p className="text-sm text-[var(--fg-muted)] mt-1">
          Publica en tu muro: una nota, un producto, una colección o un evento.
        </p>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-[var(--border)] mb-6" aria-label="Secciones del editor">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-[var(--accent)] text-[var(--fg)] font-medium'
                : 'border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)]'
            }`}
          >
            <i className={t.icon} aria-hidden /> {t.label}
          </button>
        ))}
      </nav>

      {tab === 'wall' && <WallTab shop={shop} objects={objects} initialEntries={initialEntries} />}
    </div>
  )
}
