import { redirect } from 'next/navigation'

/**
 * The supply import re-homed under the admin shell at `/admin/supply` (S2.2).
 * This thin redirect keeps any old bookmark working. `?secret=` is preserved so
 * a legacy secret link still lands on the (dual-accept) admin page until S2.3.
 */
export default async function LegacySupplyRedirect({ searchParams }: { searchParams: Promise<{ secret?: string }> }) {
  const { secret } = await searchParams
  redirect(secret ? `/admin/supply?secret=${encodeURIComponent(secret)}` : '/admin/supply')
}
