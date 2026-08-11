import { BuyerCopyText } from '@/app/components/BuyerPresentationContext'
import { Suspense } from 'react'
import BundleCheckoutClient from './BundleCheckoutClient'

export default function BundleCheckoutPage() {
  return (
    <Suspense fallback={<main className="max-w-[640px] mx-auto px-4 py-8"><BuyerCopyText copyKey="checkout.bundle.page.339c45f3" /></main>}>
      <BundleCheckoutClient />
    </Suspense>
  )
}
