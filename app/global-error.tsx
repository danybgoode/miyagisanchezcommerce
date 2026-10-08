'use client'

import ErrorPage from '@/app/error'

// Root-layout failures need their own document; reuse the branded page error.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="es"><body><ErrorPage error={error} reset={reset} /></body></html>
}
