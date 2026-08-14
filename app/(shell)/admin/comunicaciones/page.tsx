import ComunicacionesClient from './ComunicacionesClient'
import { requireAdmin } from '@/lib/admin/guard'
import { COMMUNICATION_CATALOG } from '@/lib/notifications/catalog'
import { COMMUNICATION_FIXTURES } from '@/lib/notifications/fixtures'
import { SAMPLE_RECIPIENTS } from '@/lib/notifications/sample'

export const metadata = { title: 'Comunicaciones — Admin' }

/**
 * The communications matrix (marketplace-communications · S2.1).
 *
 * Every message the platform can send, with its trigger, the actor who causes it,
 * the actor who receives it and its channels — rendered straight from
 * `lib/notifications/catalog.ts`, which a spec keeps in step with `lib/email.ts`.
 * **Clerk-gated.**
 *
 * Totals are computed here from the catalog, never typed. A hand-counted number is
 * stale on arrival.
 */
export default async function AdminComunicacionesPage() {
  await requireAdmin()
  const fixtures = new Set(Object.keys(COMMUNICATION_FIXTURES))
  const rows = COMMUNICATION_CATALOG.map((entry) => ({
    ...entry,
    // Whether "Enviarme esta" is offered at all. An entry with no fixture says so
    // rather than presenting a button that would refuse.
    sendable: fixtures.has(entry.key),
  }))
  return <ComunicacionesClient rows={rows} recipients={[...SAMPLE_RECIPIENTS]} />
}
