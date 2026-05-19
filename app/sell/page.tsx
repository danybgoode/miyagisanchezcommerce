import Link from 'next/link'

export default function SellPage() {
  return (
    <div className="max-w-lg mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-bold mb-3">Publica en Miyagi Sánchez</h1>
      <p className="text-[var(--color-muted)] mb-8">
        Gestiona tus productos y servicios desde el panel de Bonsai y aparecerán automáticamente en el marketplace.
      </p>
      <a href="https://dashboard.despachobonsai.com/dashboard/commerce"
        className="inline-block bg-[var(--color-accent)] !text-white px-6 py-3 rounded font-medium no-underline hover:bg-[var(--color-accent-hover)]">
        Abrir panel de ventas →
      </a>
      <p className="text-xs text-[var(--color-muted)] mt-4">¿No tienes cuenta? <a href="https://dashboard.despachobonsai.com/sign-up" className="text-[var(--color-accent)]">Regístrate gratis</a></p>
    </div>
  )
}
