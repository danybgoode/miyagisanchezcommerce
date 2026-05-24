import { currentUser } from '@clerk/nextjs/server'
import Link from 'next/link'
import { db } from '@/lib/supabase'
import SellWizard from './SellWizard'

export const metadata = {
  title: 'Publicar anuncio — Miyagi Sánchez',
  description: 'Publica tu producto, servicio o renta en segundos. Sin comisiones, sin complicaciones.',
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

  let existingShop: ExistingShop | null = null
  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, slug, name, location')
    .eq('clerk_user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (shop) existingShop = shop as ExistingShop

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <SellWizard existingShop={existingShop} />
    </div>
  )
}
