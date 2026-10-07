import { requireAdmin } from '@/lib/admin/guard'
import ClaimCampaignClient from './ClaimCampaignClient'

export const metadata = { title: 'Reclamación de tiendas — Admin' }

export default async function ClaimCampaignPage() {
  await requireAdmin()
  return <ClaimCampaignClient />
}
