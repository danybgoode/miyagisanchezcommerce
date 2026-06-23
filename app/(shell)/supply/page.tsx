import { redirect } from 'next/navigation'

/**
 * The supply import re-homed under the admin shell at `/admin/supply` (S2.2).
 * This thin redirect points an old `/supply` bookmark at the new path; the
 * destination is Clerk-gated (S2.3), so a legacy `?secret=` bookmark now
 * requires a Clerk admin session (the secret no longer grants access).
 */
export default async function LegacySupplyRedirect() {
  redirect('/admin/supply')
}
