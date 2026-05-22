import { redirect } from 'next/navigation'
import SupplyClient from './SupplyClient'

export default async function SupplyPage({ searchParams }: { searchParams: Promise<{ secret?: string }> }) {
  const { secret } = await searchParams
  if (secret !== process.env.ADMIN_SECRET) {
    redirect('/')
  }

  return <SupplyClient secret={secret!} />
}
