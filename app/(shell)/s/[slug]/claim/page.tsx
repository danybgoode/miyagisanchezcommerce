import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getShop } from '@/lib/listings'
import { assertShopNotPreviewPrivate } from '@/lib/preview-access'
import ClaimForm from '../ClaimForm'

export default async function ClaimPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const shop = await getShop(slug)
  if (!shop) notFound()
  // Consent-safe previews: a preview-private shop must not expose its name — nor a
  // live claim form — before the merchant has approved being presented at all.
  await assertShopNotPreviewPrivate(shop)

  if (shop.clerk_user_id) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12">
        <nav className="text-sm text-[var(--color-muted)] mb-6">
          <Link href={`/s/${slug}`} className="hover:text-[var(--color-text)]">{shop.name}</Link>
          {' › '}
          <span>Reclamar tienda</span>
        </nav>

        {/* Already claimed — Google My Business pattern */}
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
          {/* Header */}
          <div className="bg-[var(--color-background)] px-5 py-4 border-b border-[var(--color-border)] flex items-center gap-3">
            <i className="iconoir-shop text-2xl" aria-hidden />
            <div>
              <p className="font-bold text-[var(--color-text)]">{shop.name}</p>
              <p className="text-xs text-[var(--color-muted)]">miyagisanchez.com/s/{slug}</p>
            </div>
            <span className="ml-auto text-xs font-semibold bg-[var(--accent)] text-[color:var(--fg-inverse)] px-2 py-0.5 rounded">
              Reclamada
            </span>
          </div>

          {/* Body: is it you? */}
          <div className="px-5 py-5 space-y-5">
            <div className="flex items-start gap-3 p-4 bg-[var(--claim-accent-soft)] border border-[var(--claim-accent-border)] rounded-lg">
              <i className="iconoir-user text-xl mt-0.5" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-[var(--color-text)] mb-1">
                  ¿Ya tienes cuenta y fuiste tú quien la reclamó?
                </p>
                <p className="text-xs text-[var(--color-muted)] mb-3">
                  Accede directamente a tu panel para gestionar esta tienda.
                </p>
                <a
                  href="https://dashboard.despachobonsai.com/dashboard/commerce"
                  className="btn btn-primary"
                >
                  Ir a mi panel de ventas →
                </a>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <i className="iconoir-warning-triangle text-xl mt-0.5" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-[var(--color-text)] mb-1">
                  ¿Eres el dueño real pero no fuiste tú?
                </p>
                <p className="text-xs text-[var(--color-muted)] mb-2">
                  Escríbenos y recuperamos tu tienda en menos de 24 horas.
                </p>
                <a
                  href="mailto:miyagi@despachobonsai.com?subject=Recuperar%20tienda%3A%20{slug}&body=Hola%2C%20soy%20el%20due%C3%B1o%20de%20{shop.name}%20y%20necesito%20recuperar%20acceso."
                  className="text-sm font-semibold text-amber-700 no-underline hover:underline"
                >
                  miyagi@despachobonsai.com
                </a>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-background)]">
            <Link href={`/s/${slug}`} className="text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] no-underline">
              ← Ver tienda
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-12">
      <nav className="text-sm text-[var(--color-muted)] mb-6">
        <Link href={`/s/${slug}`} className="hover:text-[var(--color-text)]">{shop.name}</Link>
        {' › '}
        <span>Reclamar tienda</span>
      </nav>
      <h1 className="text-xl font-bold mb-1">¿Es tuya esta tienda?</h1>
      <p className="text-base font-semibold text-[var(--color-text)] mb-1">{shop.name}</p>
      <p className="text-sm text-[var(--color-muted)] mb-6">
        Reclamarla te da acceso a un panel de ventas gratuito: gestiona tus anuncios, recibe pedidos y publica en otros canales. Solo necesitas tu correo.
      </p>
      <ClaimForm shopId={shop.id} shopSlug={slug} shopName={shop.name} />
    </div>
  )
}
