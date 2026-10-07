import { CONTACT_EMAIL } from '@/lib/contact'
import { auth } from '@clerk/nextjs/server'
import Link from 'next/link'
import { verifyClaimToken } from '@/lib/claimJwt'
import { canRedeemClaimToken } from '@/lib/claim-invitation'
import ClaimRedeemer from './ClaimRedeemer'

export default async function ClaimPage({ searchParams }: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  let shopName: string | null = null
  let shopSlug: string | null = null
  let shopMarket: 'mx' | 'us' = 'mx'
  if (token) {
    try {
      const payload = await verifyClaimToken(token)
      if (canRedeemClaimToken(payload)) {
        shopName = payload.shopName
        shopSlug = payload.shopSlug
        shopMarket = payload.market === 'us' ? 'us' : 'mx'
      }
    } catch { /* The visible recovery path below covers expired links. */ }
  }
  if (!shopName || !shopSlug || !token) return <main className="mx-auto max-w-xl px-5 py-16">
    <h1 className="text-2xl font-bold">Este enlace ya no está disponible</h1>
    <p className="mt-4">Pídenos una invitación nueva para reclamar tu tienda.</p>
    <a className="mt-6 inline-block underline" href={`mailto:${CONTACT_EMAIL}`}>Contactar a Miyagi Sánchez</a>
  </main>

  const { userId } = await auth()
  const returnTo = `/claim?token=${encodeURIComponent(token)}`
  return <main className="mx-auto max-w-xl px-5 py-16">
    <h1 className="text-2xl font-bold">{shopMarket === 'us' ? `You are claiming ${shopName}` : `Estás reclamando ${shopName}`}</h1>
    <p className="mt-4">{shopMarket === 'us'
      ? 'Create an account or sign in. We will then link this shop to your account automatically. Use any email or Google account you prefer.'
      : 'Crea una cuenta o inicia sesión. Después vincularemos esta tienda a tu cuenta automáticamente. Puedes usar el correo o la cuenta de Google que prefieras.'}</p>
    <Link className="mt-5 inline-block underline" href={`/${shopMarket}/s/${encodeURIComponent(shopSlug)}`} referrerPolicy="no-referrer">{shopMarket === 'us' ? 'See the current shop' : 'Ver la tienda actual'}</Link>
    {userId ? <ClaimRedeemer token={token} market={shopMarket} /> : <div className="mt-8 flex flex-wrap gap-3">
      <Link className="btn btn-primary" href={`/sign-up?redirect_url=${encodeURIComponent(returnTo)}&market=${shopMarket}`}>{shopMarket === 'us' ? 'Create account' : 'Crear cuenta'}</Link>
      <Link className="btn btn-secondary" href={`/sign-in?redirect_url=${encodeURIComponent(returnTo)}&market=${shopMarket}`}>{shopMarket === 'us' ? 'Sign in' : 'Ya tengo cuenta'}</Link>
    </div>}
  </main>
}
