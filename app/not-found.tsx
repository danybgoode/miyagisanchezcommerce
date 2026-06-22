import Link from 'next/link'

// Global 404 — intentionally chrome-free. It renders under the STATIC root layout
// (the dynamic `(shell)` layout that decides platform-vs-white-label chrome isn't in
// its layout chain), and it can't read the channel headers to know whether the request
// is white-label. The old dynamic root suppressed platform chrome on embed/white-label
// 404s, so wrapping this in the platform shell would wrongly leak the platform header
// (and its search box) onto embed/custom-domain 404s. Bare is the channel-safe choice.
export default function NotFound() {
  return (
    <div className="max-w-md mx-auto px-4 py-16 text-center">
      <p className="text-5xl mb-4">404</p>
      <h1 className="text-lg font-bold mb-2">Página no encontrada</h1>
      <p className="text-[var(--color-muted)] text-sm mb-6">El anuncio o tienda que buscas no existe o fue eliminado.</p>
      <Link href="/" className="text-[var(--color-accent)] text-sm">← Volver al inicio</Link>
    </div>
  )
}
