import LazySignUp from '@/app/components/clerk-lazy/LazySignUp'
import Link from 'next/link'

export const metadata = { title: 'Crear cuenta' }

export default async function SignUpPage({ searchParams }: {
  searchParams: Promise<{ redirect_url?: string; market?: string }>
}) {
  const { redirect_url: returnTo, market } = await searchParams
  const claimingShop = typeof returnTo === 'string' && returnTo.startsWith('/claim?token=')
  const englishClaim = claimingShop && market === 'us'
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center px-4 py-12">
      <p className="text-sm text-[var(--color-muted)] mb-6 text-center">
        {claimingShop
          ? englishClaim
            ? 'Create an account with Google or any email you prefer. We will link the shop to your account when you finish.'
            : 'Crea tu cuenta con Google o el correo que prefieras. Al terminar, vincularemos la tienda a tu cuenta.'
          : 'Crea tu cuenta gratis y empieza a vender en minutos.'}
      </p>
      <LazySignUp routing="hash" />
      {claimingShop && <Link className="mt-5 text-sm underline" href={`/sign-in?redirect_url=${encodeURIComponent(returnTo)}&market=${englishClaim ? 'us' : 'mx'}`}>
        {englishClaim ? 'Already have an account? Sign in to claim the shop.' : '¿Ya tienes cuenta? Inicia sesión para reclamar la tienda.'}
      </Link>}
    </div>
  )
}
