import Link from 'next/link'
import type { Metadata } from 'next'
import { marketLandingMetadata } from '@/lib/market-seo'

/**
 * The US market exists as an invitation surface, not as a catalog.
 *
 * There are deliberately no child routes under this directory. That makes a
 * Mexico product id under `/us/l/...` an ordinary structural 404, and keeps the
 * invitation state honest without a runtime filter or an empty-looking catalog.
 */
export const metadata: Metadata = {
  title: 'Miyagi Sánchez United States — Private pilot',
  description:
    'Miyagi Sánchez is preparing a private United States operator pilot. The US marketplace and checkout are not open.',
  ...marketLandingMetadata('us'),
}

export default function UnitedStatesPilotPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-14" data-testid="us-invitation">
      <p className="badge badge-soft mb-4">Private pilot · invitation only</p>
      <h1 className="text-3xl font-bold mb-4">Miyagi Sánchez in the United States</h1>
      <p className="text-[var(--color-muted)] leading-7 mb-4">
        We are preparing a small operator pilot. The United States marketplace is not open,
        and there is no US catalog, dollar checkout, shipping, or payment promise yet.
      </p>
      <p className="text-[var(--color-muted)] leading-7 mb-8">
        Miyagi-owned shops and country marketplaces are separate: a merchant&apos;s shop is
        their own channel, while each Miyagi Market opens only when its local commerce rails
        are ready.
      </p>
      <Link href="/" className="btn btn-secondary no-underline">
        Choose another market
      </Link>
    </main>
  )
}
