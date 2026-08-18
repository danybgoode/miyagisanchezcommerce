'use client'

import dynamic from 'next/dynamic'
import type { DisenoInitial } from '../settings/_sections/Diseno'

/**
 * Living Shop — the Brand tab (epic 07, Story 5.1).
 *
 * It MOUNTS the shipped `Diseno` section rather than reimplementing it. Story
 * 5.1 says to reuse or move the existing logo/banner/tagline/social/accent
 * controls "rather than duplicate persistence", and a second copy of that form
 * would be a second write path into `settings.theme` — two forms, one row, and
 * whichever saved last wins.
 *
 * `Diseno` stays where it is and its own route keeps working; this is a second
 * ENTRANCE to one component, not a fork of it. The anti-monolith guard covers
 * both directories, so neither can grow into the other's problem.
 */

const Diseno = dynamic(() => import('../settings/_sections/Diseno'))

export default function BrandTab({ initial }: { initial: DisenoInitial }) {
  return (
    <div>
      <p className="text-sm text-[var(--fg-muted)] mb-4">
        Tu logo, tu portada, tu eslogan y tus redes. Es la misma configuración que en Diseño y marca.
      </p>
      <Diseno initial={initial} />
    </div>
  )
}
