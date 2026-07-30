import { ClaimPage } from '@/app/(shell)/s/[slug]/claim/page'

export default function MexicoClaimPage({ params }: { params: Promise<{ slug: string }> }) {
  return ClaimPage({ params, marketBasePath: '/mx' })
}
