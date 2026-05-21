import { SignUp } from '@clerk/nextjs'

export const metadata = { title: 'Crear cuenta' }

export default function SignUpPage() {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center px-4 py-12">
      <p className="text-sm text-[var(--color-muted)] mb-6 text-center">
        Crea tu cuenta gratis y empieza a vender en minutos.
      </p>
      <SignUp routing="hash" />
    </div>
  )
}
