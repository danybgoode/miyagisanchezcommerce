'use client'

/**
 * Living Shop — the studio shell (epic 07, Story 5.1).
 *
 * Five areas, one surface: Muro · Secciones · Tema · Marca · Vista previa.
 *
 * The shell owns ONLY tab state and the pending presentation draft. Each tab
 * owns its own persistence, so nothing here becomes a controller for the whole
 * page — that is how `Diseno.tsx`'s predecessor reached 4,076 lines and had to
 * be deleted.
 *
 * The draft lives here rather than in each tab because Vista previa has to show
 * what Tema and Secciones are ABOUT to do. It is client state only: the public
 * shop reads persisted settings for everyone else, so Story 5.5's rule — the
 * public shop never renders unsaved local state — holds because there is no path
 * from this object to anybody else's request.
 */

import { useState } from 'react'
import WallTab from './WallTab'
import SectionsTab from './SectionsTab'
import PreviewTab from './PreviewTab'
import { normalizeSections } from '@/lib/shop-presentation/sections'
import type { SectionConfig } from '@/lib/shop-presentation/types'
import type { StudioObjects, StudioShop, StudioTab } from './types'
import type { WallEntry } from '@/lib/wall/types'

const TABS: Array<{ key: StudioTab; label: string; icon: string }> = [
  { key: 'wall', label: 'Muro', icon: 'iconoir-post' },
  { key: 'sections', label: 'Secciones', icon: 'iconoir-list' },
  { key: 'preview', label: 'Vista previa', icon: 'iconoir-eye' },
]

export default function StudioClient({
  shop,
  initialEntries,
  objects,
  settings,
  availability,
}: {
  shop: StudioShop
  initialEntries: WallEntry[]
  objects: StudioObjects
  settings: Record<string, unknown>
  availability: Record<string, boolean>
}) {
  const [tab, setTab] = useState<StudioTab>('wall')

  // Only the SECTION draft lives here — it is the one thing Vista previa has to
  // show before it is saved. How the shop LOOKS is a preset, chosen in Diseño y
  // marca, so there is nothing about it to draft here and no second picker that
  // could disagree with that one.
  const [sections, setSections] = useState<SectionConfig>(() => normalizeSections(settings.sections))

  return (
    <div className="max-w-5xl mx-auto px-4 pb-16">
      <header className="pt-2 pb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Muro y secciones</h1>
          <p className="text-sm text-[var(--fg-muted)] mt-1">
            Publica en tu muro y elige qué secciones ve la gente. El look de tu tienda se elige en Diseño y marca.
          </p>
        </div>
        {/* A direct way out to the real thing. The studio shows a merchant what
            they are editing; only the live shop shows them what a visitor sees,
            and Story 5.5 asks for this escape hatch by name.
            The MARKET-PREFIXED href is deliberate: bare `/s/<slug>` is a
            redirect source, and `market-route-population.spec.ts` caught this
            link pointing at it. A platform link goes to the canonical
            destination, not through a hop. */}
        <a
          href={`/mx/s/${shop.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 text-sm px-3 py-2 rounded-lg border border-[var(--border)] no-underline text-[var(--fg)]"
        >
          <i className="iconoir-open-new-window" aria-hidden /> Ver mi tienda
        </a>
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

      {tab === 'wall' && <WallTab objects={objects} initialEntries={initialEntries} />}
      {tab === 'sections' && <SectionsTab value={sections} available={availability} onChange={setSections} />}
      {tab === 'preview' && <PreviewTab shop={shop} sections={sections} />}
    </div>
  )
}
