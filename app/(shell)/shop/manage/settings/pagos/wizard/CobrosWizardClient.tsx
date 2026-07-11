'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SellerBreadcrumb } from '../../../SellerBreadcrumb'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Banner } from '@/components/feedback/Banner'
import { resolveCobrosWizardStep } from '@/lib/cobros-wizard'
import { pushAnalyticsEvent } from '@/lib/analytics-events'
import { getOnboardingElapsedMs } from '@/lib/onboarding-timing'

function WizardStepDots({ step }: { step: 1 | 2 | 3 }) {
  const labels = ['Elige', 'Conecta', 'Listo']
  return (
    <div className="flex items-center gap-2 mb-8">
      {labels.map((label, i) => {
        const idx = (i + 1) as 1 | 2 | 3
        const done = idx < step
        const active = idx === step
        return (
          <div key={label} className="flex items-center gap-2">
            {i > 0 && (
              <div className={`h-px flex-1 w-8 ${done ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'}`} />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className={`w-6 h-6 rounded-[var(--r-pill)] flex items-center justify-center text-xs font-bold transition-colors ${
                  done || active
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-border)] text-[var(--color-muted)]'
                }`}
              >
                {done ? '✓' : idx}
              </div>
              <span className={`text-sm font-medium ${active ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'}`}>
                {label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function CobrosWizardClient({
  mpConnected,
  mp,
  reason,
  shopSlug,
}: {
  mpConnected: boolean
  mp: string | null
  reason: string | null
  shopSlug: string
}) {
  const { step: initialStep, banner, errorReason } = resolveCobrosWizardStep({ mp, reason, mpConnected })
  const [step, setStep] = useState<1 | 2 | 3>(initialStep)

  // S7 OAuth return rate (Story 3.3) — fires once per landing with a round-trip
  // query param, whether the return was a success or an error.
  useEffect(() => {
    if (mp === 'connected' || mp === 'error') {
      pushAnalyticsEvent('cobros_wizard_oauth_return', { provider: 'mercadopago', outcome: mp })
    }
  }, [mp])

  // time_to_payable (Story 3.3) — fires once, the first time the wizard
  // reaches "¡Listo!"; null onboarding-start (a returning seller who never
  // went through Bienvenida) means no event, nothing to divide by zero.
  useEffect(() => {
    if (step !== 3) return
    const elapsedMs = getOnboardingElapsedMs()
    if (elapsedMs == null) return
    pushAnalyticsEvent('time_to_payable', { elapsed_ms: elapsedMs }, { dedupeKey: 'time_to_payable' })
  }, [step])

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="mb-5">
        <SellerBreadcrumb extra={[{ label: 'Cobros', href: null }]} />
        <h1 className="text-xl font-bold mt-2">Activa cómo te pagan</h1>
      </div>

      <WizardStepDots step={step} />

      {step === 1 && (
        <Card variant="panel" className="p-5">
          <h2 className="font-semibold mb-1">Elige cómo te pagan</h2>
          <p className="text-sm text-[var(--color-muted)] mb-4">
            Recomendamos Mercado Pago — tarjeta, OXXO, wallet y meses sin intereses, sin comisión de plataforma.
          </p>

          {banner === 'error' && (
            <Banner variant="danger" className="mb-4">
              <span className="font-semibold">No se pudo conectar Mercado Pago.</span>{' '}
              {errorReason ? errorReason : 'Intenta de nuevo.'}
            </Banner>
          )}

          <Banner variant="info" className="mb-4">
            Te llevaremos a Mercado Pago para autorizar. Al terminar regresas aquí solito, con todo guardado.
          </Banner>

          <a
            href="/api/mp/connect?redirect_to=wizard"
            className="flex items-center justify-center gap-2 w-full bg-[var(--provider-mercadopago)] text-[var(--fg-inverse)] font-semibold py-2.5 rounded-[var(--r-md)] text-sm no-underline hover:opacity-90 transition-opacity mb-3"
          >
            Conectar Mercado Pago
          </a>

          <p className="text-center">
            <a href="/api/stripe/connect" className="text-xs text-[var(--color-muted)] hover:underline">
              o conecta Stripe →
            </a>
          </p>
        </Card>
      )}

      {step === 2 && (
        <Card variant="panel" className="p-5">
          <Banner variant="success" className="mb-4">
            <span className="font-semibold">Mercado Pago conectado ✓</span>
          </Banner>
          <p className="text-sm text-[var(--color-muted)] mb-4">
            Tu cuenta está lista. Los pagos llegan directo a tu cuenta de Mercado Pago.
          </p>
          <Button type="button" variant="primary" onClick={() => setStep(3)} className="w-full">
            Continuar
          </Button>
        </Card>
      )}

      {step === 3 && (
        <Card variant="panel" className="p-5 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-[var(--success-soft)] rounded-[var(--r-pill)] mb-4">
            <span className="text-3xl">✅</span>
          </div>
          <h2 className="text-xl font-bold">¡Listo!</h2>
          <p className="text-sm text-[var(--color-muted)] mt-1">Ya puedes cobrar con Mercado Pago.</p>
          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <Link href="/shop/manage" className="btn btn-primary flex-1 text-center no-underline">
              Volver a mi Resumen
            </Link>
            <a href={`/s/${shopSlug}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary flex-1 text-center no-underline">
              Probar un pago de $10
            </a>
          </div>
        </Card>
      )}
    </div>
  )
}
