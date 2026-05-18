import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getShop } from '@/lib/listings'
import ClaimForm from '../ClaimForm'

export default async function ClaimPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const shop = await getShop(slug)
  if (!shop) notFound()
  if (shop.clerk_user_id) redirect(`/s/${slug}`)

  return (
    <div className="max-w-lg mx-auto px-4 py-12">
      <nav className="text-sm text-[var(--color-muted)] mb-6">
        <Link href={`/s/${slug}`} className="hover:text-[var(--color-text)]">{shop.name}</Link>
        {' › '}
        <span>Reclamar tienda</span>
      </nav>
      <h1 className="text-xl font-bold mb-2">Reclamar &ldquo;{shop.name}&rdquo;</h1>
      <p className="text-sm text-[var(--color-muted)] mb-6">
        Si eres el dueño de esta tienda, ingresa tu correo y te enviaremos un enlace para conectarla a tu cuenta de despachobonsai.
      </p>
      <ClaimForm shopId={shop.id} shopSlug={slug} shopName={shop.name} />
    </div>
  )
}
