import LazySignIn from '@/app/components/clerk-lazy/LazySignIn'

export const metadata = { title: 'Iniciar sesión' }

export default async function SignInPage({ searchParams }: {
  searchParams: Promise<{ redirect_url?: string; market?: string }>
}) {
  const { redirect_url: returnTo, market } = await searchParams
  const claimingShop = typeof returnTo === 'string' && returnTo.startsWith('/claim?token=')
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center px-4 py-12">
      <p className="text-sm text-[var(--color-muted)] mb-6 text-center">
        {claimingShop
          ? market === 'us' ? 'Sign in with any account to claim this shop.' : 'Inicia sesión con cualquier cuenta para reclamar esta tienda.'
          : 'Entra a tu cuenta para publicar y gestionar tus anuncios.'}
      </p>
      <LazySignIn routing="hash" />
    </div>
  )
}
