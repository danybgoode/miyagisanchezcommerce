import Link from 'next/link'
import PlatformShell from '@/app/components/PlatformShell'

// Global 404. It renders under the static root layout only (the dynamic `(shell)`
// chrome isn't in its layout chain), so it wraps itself in PlatformShell to keep the
// platform header/footer it used to inherit from the old dynamic root layout.
export default function NotFound() {
  return (
    <PlatformShell platformThemeEligible={false}>
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="text-5xl mb-4">404</p>
        <h1 className="text-lg font-bold mb-2">Página no encontrada</h1>
        <p className="text-[var(--color-muted)] text-sm mb-6">El anuncio o tienda que buscas no existe o fue eliminado.</p>
        <Link href="/" className="text-[var(--color-accent)] text-sm">← Volver al inicio</Link>
      </div>
    </PlatformShell>
  )
}
