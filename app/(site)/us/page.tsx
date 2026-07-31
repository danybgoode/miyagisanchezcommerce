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
    <main className="max-w-3xl mx-auto px-4 py-14 sm:py-20" data-testid="us-invitation">
      <div className="max-w-2xl">
        <p className="badge badge-soft mb-5">Private pilot · research invitation</p>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)] mb-3">
          Working hypothesis · United States
        </p>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.05] mb-5">
          Run distinctive independent-product shops as one operating practice.
        </h1>
        <p className="text-lg text-[var(--color-muted)] leading-8 mb-5">
          We are looking for owner-led agencies and operators who steward roughly three to twenty
          independent-product brands on Shopify or WooCommerce today. The research question is
          whether one agent-connected commerce system can make the repeated operating work across
          those shops more legible and safer to run.
        </p>
        <p className="text-[var(--color-muted)] leading-7 mb-8">
          This is a hypothesis to test in conversations, not a public product launch. A merchant&apos;s
          owned shop remains its own channel; a country marketplace opens only when its local
          commerce rails are ready.
        </p>

        <section
          className="border-y border-[var(--color-border)] py-5 mb-8"
          aria-labelledby="us-pilot-proof-heading"
          data-testid="us-pilot-proof"
        >
          <p id="us-pilot-proof-heading" className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)] mb-4">
            The first proof we are seeking
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
            <ProofStep label="One operator" detail="A specialist team with real recurring shop work." />
            <span className="hidden sm:block text-[var(--color-muted)]" aria-hidden="true">→</span>
            <ProofStep label="Three consenting client shops" detail="Real merchants, explicit access, and shared learning." />
            <span className="hidden sm:block text-[var(--color-muted)]" aria-hidden="true">→</span>
            <ProofStep label="One operating system" detail="A pilot to evaluate, not a parity promise." />
          </div>
        </section>

        <div className="flex flex-wrap gap-3">
          <a
            href="mailto:daniel@miyagisanchez.com?subject=US%20operator%20pilot%20research"
            className="btn btn-primary no-underline"
            data-testid="us-research-cta"
          >
            Request a research conversation
          </a>
          <Link href="/" className="btn btn-secondary no-underline">
            Choose another market
          </Link>
        </div>
      </div>

      <aside className="max-w-2xl mt-12 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-5 text-sm text-[var(--color-muted)] leading-6">
        <strong className="block text-[var(--color-fg)] mb-1">What is not available yet</strong>
        There is no open US marketplace, catalog, dollar checkout, shipping, payment promise, or
        self-service availability claim. We are not claiming Amazon, eBay, Walmart, accounting,
        Veeqo, or ShipStation parity before the interviews establish the pilot&apos;s real need.
      </aside>
    </main>
  )
}

function ProofStep({ label, detail }: { label: string; detail: string }) {
  return (
    <div>
      <p className="font-semibold">{label}</p>
      <p className="text-sm text-[var(--color-muted)] leading-5 mt-1">{detail}</p>
    </div>
  )
}
