import { currentUser, auth } from '@clerk/nextjs/server'
import Link from 'next/link'
import SellWizard from './SellWizard'

// First-run, agent-native path (Onboarding 0, Sprint 2). Offered to signed-in
// users who don't have a shop yet; the manual <SellWizard> stays as the no-agent
// fallback right below it.
function AgentSetupNudge() {
  return (
    <Link
      href="/sell/setup"
      className="block no-underline rounded-2xl border border-[var(--color-border)] bg-[var(--surface-muted)] p-4 mb-5 hover:border-[var(--color-accent)] transition-colors"
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none">✨</span>
        <div>
          <p className="font-semibold text-[var(--fg)] text-sm">
            ¿Tu agente ya armó tu tienda? Pégala aquí.
          </p>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">
            Si tu IA generó un archivo de configuración, créala con catálogo en un solo paso —
            sin llenar el formulario. <span className="text-[var(--color-accent)] font-medium">Abrir →</span>
          </p>
        </div>
      </div>
    </Link>
  )
}

export const metadata = {
  title: 'Publicar anuncio — Miyagi Sánchez',
  description: 'Publica tu producto, servicio o renta en segundos. Sin comisiones, sin complicaciones.',
}

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

function medusaFetch(path: string, clerkJwt: string) {
  return fetch(`${MEDUSA_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
      Authorization: `Bearer ${clerkJwt}`,
    },
    cache: 'no-store',
  })
}

interface ExistingShop {
  id: string
  slug: string
  name: string
  location: string | null
}

export default async function SellPage() {
  const user = await currentUser()

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16">
        {/* Hero */}
        <div className="text-center mb-12">
          <span className="badge badge-mono" style={{ marginBottom: 16, display: 'inline-block' }}>
            0% comisión
          </span>
          <h1 className="t-h1" style={{ marginBottom: 12 }}>
            Vende en Miyagi Sánchez.
          </h1>
          <p className="t-lead" style={{ maxWidth: 400, margin: '0 auto 0' }}>
            Crea tu tienda en minutos. Tus productos, tus reglas, tu ganancia completa.
          </p>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          {[
            {
              icon: 'iconoir-lightning-bolt',
              title: 'Publicación instantánea',
              desc: 'Tu anuncio aparece de inmediato, sin esperar aprobación.',
            },
            {
              icon: 'iconoir-percentage',
              title: '0% comisión',
              desc: 'Todo lo que cobres es tuyo. La plataforma no cobra.',
            },
            {
              icon: 'iconoir-shield-check',
              title: 'Pagos protegidos',
              desc: 'Activa Compra Protegida y tus clientes pagan con confianza.',
            },
          ].map(f => (
            <div key={f.title} className="card-panel" style={{ padding: '20px 16px', textAlign: 'center' }}>
              <i className={f.icon} style={{ fontSize: 28, color: 'var(--accent)', display: 'block', marginBottom: 10 }} />
              <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--fg)', marginBottom: 4 }}>{f.title}</p>
              <p style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>{f.desc}</p>
            </div>
          ))}
        </div>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
          <Link href="/sign-up" className="btn btn-primary btn-lg no-underline w-full sm:w-auto text-center">
            Crear cuenta gratis →
          </Link>
          <Link href="/sign-in" className="btn btn-secondary btn-lg no-underline w-full sm:w-auto text-center">
            Ya tengo cuenta
          </Link>
        </div>

        <p style={{ fontSize: 11, color: 'var(--fg-muted)', textAlign: 'center', marginTop: 20 }}>
          Al registrarte aceptas los{' '}
          <Link href="/terminos" style={{ textDecoration: 'underline', color: 'inherit' }}>Términos de uso</Link>
          {' '}y la{' '}
          <Link href="/privacidad" style={{ textDecoration: 'underline', color: 'inherit' }}>Política de privacidad</Link>.
        </p>
      </div>
    )
  }

  // Medusa is the source of truth for sellers (same as /shop/manage). Checking it
  // here keeps shop-detection consistent: a user who created a shop but no listing
  // yet still skips Step 1 instead of being asked to re-create the shop.
  let existingShop: ExistingShop | null = null
  const { getToken } = await auth()
  const clerkJwt = await getToken()
  if (clerkJwt) {
    const sellerRes = await medusaFetch('/store/sellers/me', clerkJwt)
    if (sellerRes.ok) {
      const { seller } = await sellerRes.json() as {
        seller: { id: string; slug: string; name: string; location: string | null }
      }
      existingShop = {
        id: seller.id,
        slug: seller.slug,
        name: seller.name,
        location: seller.location ?? null,
      }
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {!existingShop && <AgentSetupNudge />}
      <SellWizard existingShop={existingShop} />
    </div>
  )
}
