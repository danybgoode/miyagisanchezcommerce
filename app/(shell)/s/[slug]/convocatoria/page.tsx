import Link from 'next/link'
import type { Metadata } from 'next'
import { isEnabled } from '@/lib/flags'
import { getLaunchpadShopBySlug } from '@/lib/launchpad'
import { isShopPreviewPrivateBySlug } from '@/lib/preview-access'
import { MAX_MANUSCRIPT_SIZE_MB } from '@/lib/launchpad-types'
import ConvocatoriaClient from './ConvocatoriaClient'

export const dynamic = 'force-dynamic'

// Copyright / takedown posture shown on the portal (confirmed 2026-07-07):
// the writer keeps copyright and grants the shop a non-exclusive license; the
// shop/platform can take any work down on request or complaint.
const TERMS = `Al enviar tu obra confirmas que eres el autor o que tienes los derechos para compartirla.

Conservas los derechos de autor de tu manuscrito. Al enviarlo, concedes a la librería y a Miyagi Sánchez una licencia no exclusiva para leerlo y revisarlo y —solo si se aprueba y publica— para ofrecerlo como libro digital o impreso.

Puedes pedir que retiremos tu obra en cualquier momento escribiéndonos, y la librería puede retirar cualquier obra a su criterio o ante una reclamación de derechos.`

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const shop = await getLaunchpadShopBySlug(slug)
  return { title: shop ? `Convocatoria — ${shop.name}` : 'Convocatoria', robots: { index: false } }
}

function StateMessage({ title, body }: { title: string; body: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-[var(--color-background)]">
      <div className="max-w-md w-full border border-[var(--color-border)] rounded-xl p-6 text-center">
        <Link href="/" className="text-xs text-[var(--color-muted)] no-underline hover:underline">miyagisanchez.com</Link>
        <h1 className="mt-4 text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)] leading-6">{body}</p>
      </div>
    </main>
  )
}

export default async function ConvocatoriaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [enabled, shop] = await Promise.all([isEnabled('launchpad.enabled'), getLaunchpadShopBySlug(slug)])

  if (!enabled) {
    return <StateMessage title="Convocatoria no disponible" body="Esta función no está disponible en este momento." />
  }
  if (!shop) {
    return <StateMessage title="No encontramos esta tienda" body="Revisa el enlace e inténtalo de nuevo." />
  }
  // Consent-safe previews: this is the ONE shop sub-page middleware rewrites onto
  // the subdomain + custom-domain channels, so a preview-private shop would
  // otherwise leak its name on all three. Same copy as an unknown shop.
  if (await isShopPreviewPrivateBySlug(slug)) {
    return <StateMessage title="No encontramos esta tienda" body="Revisa el enlace e inténtalo de nuevo." />
  }
  if (!shop.acceptsManuscripts) {
    return (
      <StateMessage
        title={`${shop.name} no está recibiendo manuscritos`}
        body="Esta tienda no tiene una convocatoria abierta por ahora. Vuelve más tarde."
      />
    )
  }

  return (
    <main className="min-h-screen bg-[var(--color-background)]">
      <div className="max-w-2xl mx-auto px-4 py-6 sm:py-10">
        <div className="mb-6">
          <Link href={`/s/${shop.slug}`} className="text-sm text-[var(--color-muted)] no-underline hover:underline">
            ← {shop.name}
          </Link>
          <h1 className="text-3xl sm:text-4xl font-bold mt-3 leading-tight">Convocatoria de manuscritos</h1>
          <p className="text-base text-[var(--color-muted)] leading-7 mt-2">
            {shop.name} recibe obras de escritores. Envía la tuya y, si la aprueban, se publica como libro digital.
          </p>
        </div>

        <ConvocatoriaClient
          slug={shop.slug}
          shopName={shop.name}
          guidelines={shop.guidelines}
          maxSizeMb={MAX_MANUSCRIPT_SIZE_MB}
        />

        <div className="mt-6 border border-[var(--color-border)] rounded-xl p-5">
          <h3 className="font-semibold text-sm mb-2">Términos de la convocatoria</h3>
          <p className="text-xs leading-5 text-[var(--color-muted)] whitespace-pre-line">{TERMS}</p>
          <p className="text-xs text-[var(--color-muted)] mt-3">
            Consulta también los{' '}
            <Link href="/terminos" className="underline">términos generales</Link>.
          </p>
        </div>
      </div>
    </main>
  )
}
