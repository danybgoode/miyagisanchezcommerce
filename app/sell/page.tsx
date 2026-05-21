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

  // ── Unauthenticated: show value-prop landing ──────────────────────────────
  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16">
        {/* Hero */}
        <div className="text-center mb-12">
          <span className="inline-block bg-[var(--color-accent)] text-white text-xs font-semibold px-3 py-1 rounded-full mb-4 uppercase tracking-wide">
            100% gratis
          </span>
          <h1 className="text-3xl font-bold mb-4 leading-tight">
            Vende en Miyagi Sánchez.<br />
            <span className="text-[var(--color-accent)]">Sin comisiones. Sin trampa.</span>
          </h1>
          <p className="text-[var(--color-muted)] text-lg max-w-md mx-auto">
            Crea tu tienda en minutos y llega a miles de compradores en México.
            Tus productos, tus reglas, tu ganancia completa.
          </p>
        </div>

        {/* Features grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          {[
            { icon: '🚀', title: 'Publicación instantánea', desc: 'Tu anuncio aparece de inmediato, sin esperar aprobación.' },
            { icon: '💰', title: '0% comisión', desc: 'Todo lo que cobres es tuyo. Nunca te quitamos un centavo.' },
            { icon: '🔒', title: 'Pagos protegidos', desc: 'Activa Compra Protegida y tus clientes pagan con confianza.' },
          ].map(f => (
            <div key={f.title} className="border border-[var(--color-border)] rounded-xl p-5 text-center">
              <div className="text-2xl mb-2">{f.icon}</div>
              <div className="font-semibold text-sm mb-1">{f.title}</div>
              <div className="text-xs text-[var(--color-muted)]">{f.desc}</div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
          <Link
            href="/sign-up"
            className="inline-block bg-[var(--color-accent)] text-white px-8 py-3 rounded-lg font-semibold no-underline hover:bg-[var(--color-accent-hover)] transition-colors text-center w-full sm:w-auto"
          >
            Crear cuenta gratis →
          </Link>
          <Link
            href="/sign-in"
            className="inline-block border border-[var(--color-border)] px-8 py-3 rounded-lg font-medium no-underline hover:bg-[var(--color-surface-alt)] transition-colors text-center w-full sm:w-auto text-[var(--color-foreground)]"
          >
            Ya tengo cuenta
          </Link>
        </div>

        <p className="text-xs text-[var(--color-muted)] text-center mt-6">
          Al registrarte aceptas los <Link href="/terminos" className="underline">Términos de uso</Link> y la <Link href="/privacidad" className="underline">Política de privacidad</Link>.
        </p>
      </div>
    )
  }

  // ── Authenticated: resolve existing shop ──────────────────────────────────
  let existingShop: ExistingShop | null = null

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, slug, name, location')
    .eq('clerk_user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (shop) {
    existingShop = shop as ExistingShop
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <SellWizard existingShop={existingShop} />
    </div>
  )
}
