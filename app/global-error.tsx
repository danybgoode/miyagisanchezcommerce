'use client'

import RecoveryScreen from '@/app/components/RecoveryScreen'

// This boundary replaces a failed root layout, including its document tags.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <body>
        <RecoveryScreen
          code="500"
          title="No pudimos abrir esta página"
          message="La página no cargó como esperábamos. Intenta de nuevo o vuelve al inicio."
          onRetry={reset}
        />
      </body>
    </html>
  )
}
