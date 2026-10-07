import { CONTACT_EMAIL } from '@/lib/contact'
import { verifyClaimToken } from '@/lib/claimJwt'
import RemovalForm from './RemovalForm'

export default async function RemoveShopPage({ searchParams }: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  let shop: { name: string; slug: string; market: 'mx' | 'us' } | null = null
  if (token) {
    try {
      const payload = await verifyClaimToken(token)
      if (payload.purpose === 'removal' && (payload.market === 'mx' || payload.market === 'us')) {
        shop = { name: payload.shopName, slug: payload.shopSlug, market: payload.market }
      }
    } catch { /* Expired and invalid invitations use the support path below. */ }
  }
  if (!shop || !token) return <main className="mx-auto max-w-xl px-5 py-16">
    <h1 className="text-2xl font-bold">El enlace no está disponible / Link unavailable</h1>
    <p className="mt-4">Escríbenos para solicitar el retiro de una tienda. / Write to us to request a listing removal.</p>
    <a className="mt-5 inline-block underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
  </main>
  const english = shop.market === 'us'
  return <main className="mx-auto max-w-xl px-5 py-16">
    <h1 className="text-2xl font-bold">{english ? `Request removal of ${shop.name}` : `Solicitar que retiremos ${shop.name}`}</h1>
    <p className="mt-4">{english
      ? 'We will take this listing offline when we receive your request, then verify your connection to the business before permanent removal. You do not need an account.'
      : 'Pondremos la ficha fuera de línea cuando recibamos tu solicitud y verificaremos tu relación con el negocio antes de retirarla de forma permanente. No necesitas crear una cuenta.'}</p>
    <RemovalForm shopSlug={shop.slug} market={shop.market} token={token} />
  </main>
}
