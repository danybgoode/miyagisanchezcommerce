'use client'

import RecoveryScreen from '@/app/components/RecoveryScreen'

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RecoveryScreen
      code="500"
      title="No pudimos mostrar esta página"
      message="Hubo un problema al cargarla. Intenta de nuevo o vuelve a explorar."
      onRetry={reset}
    />
  )
}
