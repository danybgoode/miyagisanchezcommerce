import { ClaimPage } from '@/app/(shell)/s/[slug]/claim/page'

export default function UnitedStatesClaimPage({ params }: { params: Promise<{ slug: string }> }) {
  return ClaimPage({ params, market: 'us', marketBasePath: '/us' })
}
