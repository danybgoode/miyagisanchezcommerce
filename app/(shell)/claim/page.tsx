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
  if (token) {
    try {
      const payload = await verifyClaimToken(token)
      if (payload.purpose === 'campaign' || payload.purpose === 'promoter') shopName = payload.shopName
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
    redirect(`/sign-up?redirect_url=${encodeURIComponent(returnTo)}`)
  }
  return <main className="mx-auto max-w-xl px-5 py-16">
    <h1 className="text-2xl font-bold">Reclamar {shopName}</h1>
    <p className="mt-4">Vincularemos esta tienda a tu cuenta cuando el correo de tu cuenta coincida con el de la invitación.</p>
    <ClaimRedeemer token={token} />
  </main>
}
