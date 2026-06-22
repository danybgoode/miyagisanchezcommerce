import { redirect } from 'next/navigation'
import PrintAdminClient from './PrintAdminClient'

export const metadata = { title: 'Edición impresa — Admin' }

/**
 * Secret-gated admin console for the Print Edition feature. Lives at its own
 * route segment (the bare /admin page redirects to the external scraper app).
 * Auth matches the existing /api/admin/* pattern: ?secret=<ADMIN_SECRET>.
 */
export default async function PrintAdminPage({ searchParams }: { searchParams: Promise<{ secret?: string }> }) {
  const { secret } = await searchParams
  if (!secret || secret !== process.env.ADMIN_SECRET) redirect('/')
  return <PrintAdminClient secret={secret} />
}
