import { CONTACT_EMAIL } from '@/lib/contact'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { verifyClaimToken } from '@/lib/claimJwt'
import ClaimRedeemer from './ClaimRedeemer'

export default async function ClaimPage({ searchParams }: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  let shopName: string | null = null
  let shopMarket: 'mx' | 'us' = 'mx'
  if (token) {
    try {
      const payload = await verifyClaimToken(token)
      if (payload.purpose === 'campaign' || payload.purpose === 'promoter' || payload.purpose === 'public') {
        shopName = payload.shopName
        shopMarket = payload.market === 'us' ? 'us' : 'mx'
      }
    } catch { /* The visible recovery path below covers expired links. */ }
  }
  if (!shopName || !token) return <main className="mx-auto max-w-xl px-5 py-16">
    <h1 className="text-2xl font-bold">Este enlace ya no está disponible</h1>
    <p className="mt-4">Pídenos una invitación nueva para reclamar tu tienda.</p>
    <a className="mt-6 inline-block underline" href={`mailto:${CONTACT_EMAIL}`}>Contactar a Miyagi Sánchez</a>
  </main>

  const { userId } = await auth()
  if (!userId) {
    const returnTo = `/claim?token=${encodeURIComponent(token)}`
    redirect(`/sign-up?redirect_url=${encodeURIComponent(returnTo)}&market=${shopMarket}`)
  }
  return <main className="mx-auto max-w-xl px-5 py-16">
    <h1 className="text-2xl font-bold">{shopMarket === 'us' ? `Claim ${shopName}` : `Reclamar ${shopName}`}</h1>
    <p className="mt-4">{shopMarket === 'us'
      ? 'We will link this shop to your account. Use any email or Google account you prefer.'
      : 'Vincularemos esta tienda a tu cuenta. Puedes usar el correo o la cuenta de Google que prefieras.'}</p>
    <ClaimRedeemer token={token} market={shopMarket} />
  </main>
}
