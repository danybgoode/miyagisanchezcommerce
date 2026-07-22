/**
 * /preview/[token] — the opaque, revocable private preview of a proposed merchant
 * shop (founding-merchant-consent-previews S1.2 + S2.1). Renders the proposed shop +
 * its draft products (Medusa-authoritative, via getPreviewPresentation), behind a
 * clear "not public yet" banner, and lets the MERCHANT approve or request changes
 * (S2.1) — the one place explicit consent is recorded. Grants no ownership, no admin
 * controls, no checkout. An unknown / revoked / expired token returns the ordinary
 * not-found experience (never revealing which). Dark while the flag is OFF.
 */
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import Image from 'next/image'
import { isEnabled } from '@/lib/flags'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { resolvePreviewByToken, markPreviewDelivered } from '@/lib/preview-access'
import { readApprovalState } from '@/lib/preview-consent'
import { emitPreviewEvent } from '@/lib/preview-lifecycle'
import PreviewDecision from './PreviewDecision'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

// Never let a private preview into a search index or link unfurl.
export const metadata: Metadata = {
  title: 'Vista previa privada',
  robots: { index: false, follow: false },
}

function formatMxn(cents: number | null, currency: string): string {
  if (cents === null) return 'Precio por confirmar'
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' }).format(cents / 100)
}

export default async function PreviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  // Dark until the flag is flipped — the whole surface 404s while OFF.
  if (!(await isEnabled('promoter.private_preview_enabled'))) notFound()

  // Defense-in-depth brute-force guard (the token is already 256-bit opaque).
  const ip = getClientIp({ headers: await headers() } as unknown as Request)
  const rl = await checkRateLimit('embed', ip)
  if (!rl.allowed) notFound()

  const preview = await resolvePreviewByToken(token)
  if (!preview) notFound()

  // The full consent state (snapshot + current hash + approval status) — the same
  // read the decision route and the promoter workspace use, so all three agree.
  const state = await readApprovalState(preview)
  if (!state) notFound()

  // Opening the private link is "delivered". Advances a still-draft anchor only —
  // never rewinds a more-advanced status. Best-effort; render regardless.
  const justDelivered = await markPreviewDelivered(preview.id).catch(() => false)
  // Lifecycle telemetry (S3.1) — after the canonical status write, and only on the
  // real draft → delivered transition, so a re-open never re-emits.
  if (justDelivered) {
    await emitPreviewEvent('preview_delivered', {
      shopId: preview.shopId,
      previewId: preview.id,
      version: preview.currentVersion,
      productCount: state.snapshot.products.length,
    })
  }

  const products = state.snapshot.products
  const approved = state.approvedHash !== null && !state.stale
  const changesRequested = preview.status === 'changes_requested'

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-semibold">Vista previa privada — aún no es pública</p>
        <p className="mt-1 text-amber-800">
          Así se vería la tienda. Nadie más puede verla todavía: no aparece en búsquedas ni en el
          mercado. Se publica solo cuando la apruebas.
        </p>
      </div>

      <h1 className="text-2xl font-bold text-gray-900">{state.snapshot.shopName}</h1>
      <p className="mt-1 text-sm text-gray-500">
        {products.length}{' '}
        {products.length === 1 ? 'producto propuesto' : 'productos propuestos'}
      </p>

      <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {products.map((p) => (
          <li key={p.id} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            {p.imageUrl ? (
              <div className="relative aspect-square w-full bg-gray-100">
                <Image src={p.imageUrl} alt={p.title} fill className="object-cover" sizes="(max-width: 640px) 100vw, 50vw" unoptimized />
              </div>
            ) : (
              <div className="aspect-square w-full bg-gray-100" />
            )}
            <div className="p-3">
              <p className="line-clamp-2 text-sm font-medium text-gray-900">{p.title}</p>
              <p className="mt-1 text-sm text-gray-600">{formatMxn(p.priceCents, p.currency)}</p>
            </div>
          </li>
        ))}
      </ul>

      <PreviewDecision
        token={token}
        expectedHash={state.currentHash}
        approved={approved}
        changesRequested={changesRequested}
      />
    </main>
  )
}
