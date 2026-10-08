import RecoveryScreen from '@/app/components/RecoveryScreen'
import { headers } from 'next/headers'

// A channel-safe 404: this can render for marketplace and white-label URLs,
// so it provides a clear route home without adding the buyer header.
export default async function NotFound() {
  // A root not-found render can report an internal pathname to client hooks.
  // Middleware keeps the original request path in this trusted header.
  const pathname = (await headers()).get('x-miyagi-path') ?? '/'
  const market = pathname === '/us' || pathname.startsWith('/us/') ? 'us' : 'mx'
  return (
    <RecoveryScreen
      code="404"
      market={market}
      title="No encontramos esta página"
      message="El enlace pudo cambiar o el anuncio ya no está disponible. Puedes seguir explorando desde aquí."
    />
  )
}
