import { redirect } from 'next/navigation'

/**
 * The supply import re-homed under the admin shell at `/admin/supply` (S2.2).
 * This thin redirect keeps any old bookmark working; the destination is
 * Clerk-gated (S2.3), so no secret is threaded.
 */
export default async function LegacySupplyRedirect() {
  redirect('/admin/supply')
}
