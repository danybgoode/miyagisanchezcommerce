import { requireAdmin } from '@/lib/admin/guard'
import ClaimLinksClient from './ClaimLinksClient'
import { readClaimLinkDirectory } from '@/lib/admin/claim-link-directory-server'

export const metadata = { title: 'Enlaces para reclamar tiendas — Admin' }

export default async function ClaimLinksPage() {
  await requireAdmin()
  const directory = await readClaimLinkDirectory()
  return <ClaimLinksClient directory={directory} />
}
