import RecoveryScreen from '@/app/components/RecoveryScreen'

// A channel-safe 404: this can render for marketplace and white-label URLs,
// so it provides a clear route home without adding the buyer header. Keep this
// request-neutral: Next renders this boundary inside the ISR public-read tree,
// where headers() changes a static render to dynamic and turns live shops into 500s.
export default function NotFound() {
  return (
    <RecoveryScreen
      code="404"
      title="No encontramos esta página"
      message="El enlace pudo cambiar o el anuncio ya no está disponible. Puedes seguir explorando desde aquí."
    />
  )
}
