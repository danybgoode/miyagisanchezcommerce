import { requireAdmin } from '@/lib/admin/guard'
import ClaimLinksClient from './ClaimLinksClient'

export const metadata = { title: 'Enlaces para reclamar tiendas — Admin' }

export default async function ClaimLinksPage() {
  await requireAdmin()
  return <ClaimLinksClient />
}
