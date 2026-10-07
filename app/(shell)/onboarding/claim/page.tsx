import { redirect } from 'next/navigation'

/** Existing emails point here. Preserve their token while the 24-hour links expire. */
export default async function LegacyClaimPage({ searchParams }: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  redirect(token ? `/claim?token=${encodeURIComponent(token)}` : '/claim')
}
