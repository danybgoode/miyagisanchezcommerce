import { Suspense } from 'react'
import BundleCheckoutClient from './BundleCheckoutClient'

export default function BundleCheckoutPage() {
  return (
    <Suspense fallback={<main className="max-w-[640px] mx-auto px-4 py-8">Cargando paquete...</main>}>
      <BundleCheckoutClient />
    </Suspense>
  )
}
