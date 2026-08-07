import 'server-only'
import { isEnabled } from '@/lib/flags'

/** The sole runtime seam for every founding-operator recruiting-v3 surface. */
export async function recruitingV3Enabled(): Promise<boolean> {
  return isEnabled('partners.recruiting_v3_enabled')
}
