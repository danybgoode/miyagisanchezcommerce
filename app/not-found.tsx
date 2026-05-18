import Link from 'next/link'

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
