import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * The interactive Maqueta layout builder was retired in favor of the zine studio
 * (epic zine-editing-central, Story 3.1) — zine is now the one editor. This route
 * stays as a redirect (not a 404) so any old bookmark/link lands somewhere useful.
 */
export default async function BuilderPage() {
  redirect('/admin/print?notice=zine-maqueta')
}
