import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import BuyerNotificationPreferences from './BuyerNotificationPreferences'

export const metadata = { title: 'Notificaciones — Miyagi Sánchez' }

// Buyer preference center (epic #5b). Signed-in buyers only — prefs are
// clerk_user_id-keyed; guests keep today's transactional emails to their order
// address (handled by the dispatchToBuyer guest fall-through, not here).
export default async function NotificacionesPage() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      <header className="mb-6">
        <Link
          href="/account"
          className="text-sm text-[var(--color-muted)] no-underline hover:text-[var(--color-foreground)]"
        >
          ← Mi cuenta
        </Link>
        <h1 className="mt-2 text-xl font-bold">Notificaciones</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Controla qué te avisamos sobre tus compras y por qué canal.
        </p>
      </header>

      <BuyerNotificationPreferences />
    </div>
  )
}
