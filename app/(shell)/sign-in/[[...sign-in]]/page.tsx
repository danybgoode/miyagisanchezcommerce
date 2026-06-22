import { SignIn } from '@clerk/nextjs'

export const metadata = { title: 'Iniciar sesión' }

export default function SignInPage() {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center px-4 py-12">
      <p className="text-sm text-[var(--color-muted)] mb-6 text-center">
        Entra a tu cuenta para publicar y gestionar tus anuncios.
      </p>
      <SignIn routing="hash" />
    </div>
  )
}
