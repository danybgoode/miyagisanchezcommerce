import { requireAdmin } from '@/lib/admin/guard'
import ClaimLinksClient from './ClaimLinksClient'
import { readTenantDirectory } from '@/lib/admin/tenant-directory-server'

export const metadata = { title: 'Enlaces para reclamar tiendas — Admin' }

export default async function ClaimLinksPage() {
  await requireAdmin()
  const directory = await readTenantDirectory()
  return <ClaimLinksClient directory={directory} />
}
