import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getShop } from '@/lib/listings'
import { db } from '@/lib/supabase'

export default async function ClaimPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const shop = await getShop(slug)
  if (!shop) notFound()
  if (shop.clerk_user_id) redirect(`/s/${slug}`) // already claimed

  async function submitClaim(formData: FormData) {
    'use server'
    const message = formData.get('message') as string
    const email = formData.get('email') as string
    // Store claim with email as identifier (no Clerk on marketplace side yet)
    await db.from('marketplace_claims').upsert({
      shop_id: shop!.id,
      clerk_user_id: `email:${email}`,
      message,
      status: 'pending',
    }, { onConflict: 'shop_id,clerk_user_id' })
    redirect(`/s/${slug}?claimed=1`)
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-12">
      <nav className="text-sm text-[var(--color-muted)] mb-6">
        <Link href={`/s/${slug}`} className="hover:text-[var(--color-text)]">{shop.name}</Link>
        {' › '}
        <span>Reclamar tienda</span>
      </nav>
      <h1 className="text-xl font-bold mb-2">Reclamar &ldquo;{shop.name}&rdquo;</h1>
      <p className="text-sm text-[var(--color-muted)] mb-6">
        Si eres el dueño de esta tienda, envíanos tu información y te contactaremos para verificar y traspasar el perfil.
      </p>
      <form action={submitClaim} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Tu correo electrónico</label>
          <input name="email" type="email" required
            className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-accent)]"
            placeholder="tu@email.com" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">¿Por qué eres el dueño?</label>
          <textarea name="message" rows={4} required
            className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-accent)] resize-none"
            placeholder="Cuéntanos sobre tu tienda y cómo podemos verificarte..." />
        </div>
        <button type="submit"
          className="w-full bg-[var(--color-accent)] text-white py-2 rounded font-medium hover:bg-[var(--color-accent-hover)] text-sm">
          Enviar solicitud
        </button>
      </form>
    </div>
  )
}
