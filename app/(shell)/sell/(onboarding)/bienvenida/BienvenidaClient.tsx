'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  SELLS_OPTIONS,
  SELLS_WHERE_OPTIONS,
  type SellsOption,
  type SellsWhereOption,
} from '@/lib/onboarding-personalization'
import { setOnboardingSkipSignal } from '@/lib/onboarding-skip'
import { markOnboardingStart } from '@/lib/onboarding-timing'

const SELLS_LABELS: Record<SellsOption, string> = {
  product: 'Producto físico',
  service: 'Servicio',
  rental: 'Renta',
  digital: 'Producto digital',
  subscription: 'Suscripción',
}

const SELLS_WHERE_LABELS: Record<SellsWhereOption, string> = {
  mercado_libre: 'Mercado Libre',
  instagram_facebook: 'Instagram o Facebook',
  whatsapp: 'WhatsApp',
  tienda_fisica: 'Tienda física',
  sin_vender: 'Aún no vendo',
}

function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn btn-sm"
      style={{
        borderRadius: 'var(--r-pill)',
        border: selected ? '2px solid var(--accent)' : '1px solid var(--border)',
        background: selected ? 'var(--accent-soft)' : 'var(--bg-elevated)',
        color: selected ? 'var(--accent)' : 'var(--fg)',
        fontWeight: 500,
      }}
    >
      {label}
    </button>
  )
}

interface TenantIntakeResponse {
  intake: { sells: SellsOption[]; sellsWhere: SellsWhereOption[] } | null
}

export default function BienvenidaClient({ firstName }: { firstName: string | null }) {
  const router = useRouter()
  const [sells, setSells] = useState<SellsOption[]>([])
  const [sellsWhere, setSellsWhere] = useState<SellsWhereOption[]>([])
  const [saving, setSaving] = useState(false)

  // time_to_first_product / time_to_payable (Sprint 3 · Story 3.3) — mark the
  // earliest onboarding entry point once; a no-op on any later re-visit.
  useEffect(() => { markOnboardingStart() }, [])

  // Reload persistence (Story 1.1 acceptance): load any previously saved
  // chip answers back into state on mount.
  useEffect(() => {
    let cancelled = false
    fetch('/api/sell/tenant-intake')
      .then((r) => (r.ok ? (r.json() as Promise<TenantIntakeResponse>) : null))
      .then((d) => {
        if (cancelled || !d?.intake) return
        setSells(d.intake.sells)
        setSellsWhere(d.intake.sellsWhere)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  function toggleSells(v: SellsOption) {
    setSells((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))
  }
  function toggleSellsWhere(v: SellsWhereOption) {
    setSellsWhere((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))
  }

  async function handleContinue() {
    setSaving(true)
    try {
      await fetch('/api/sell/tenant-intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sells, sellsWhere }),
      }).then((res) => {
        if (!res.ok) console.error('[bienvenida] tenant-intake save failed:', res.status)
      })
    } catch (e) {
      // Non-blocking — S2 degrades to the unpersonalized default if the save failed.
      console.error('[bienvenida] tenant-intake save threw:', e)
    } finally {
      router.push('/sell/puertas')
    }
  }

  function handleSkip() {
    setOnboardingSkipSignal()
    router.push('/sell')
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 0 48px' }}>
      <h1 className="text-2xl font-bold leading-tight">
        Hola, {firstName ?? 'bienvenido'}. Tu tienda está a unos minutos.
      </h1>
      <p className="text-sm text-[var(--color-muted)] mt-2">
        Dos preguntas rápidas y opcionales — nos ayudan a preparar el resto para tu caso.
      </p>

      <Card variant="panel" className="mt-6 p-5">
        <p className="font-semibold mb-3">¿Qué vendes?</p>
        <div className="flex flex-wrap gap-2">
          {SELLS_OPTIONS.map((opt) => (
            <Chip key={opt} label={SELLS_LABELS[opt]} selected={sells.includes(opt)} onClick={() => toggleSells(opt)} />
          ))}
        </div>
      </Card>

      <Card variant="panel" className="mt-4 p-5">
        <p className="font-semibold mb-3">¿Dónde vendes hoy?</p>
        <div className="flex flex-wrap gap-2">
          {SELLS_WHERE_OPTIONS.map((opt) => (
            <Chip key={opt} label={SELLS_WHERE_LABELS[opt]} selected={sellsWhere.includes(opt)} onClick={() => toggleSellsWhere(opt)} />
          ))}
        </div>
      </Card>

      <div className="flex flex-col items-center gap-3 mt-8">
        <Button variant="primary" size="lg" onClick={handleContinue} disabled={saving} className="w-full">
          {saving ? 'Guardando…' : 'Continuar'}
        </Button>
        <button type="button" onClick={handleSkip} className="btn btn-ghost text-sm">
          Prefiero explorar por mi cuenta
        </button>
      </div>
    </div>
  )
}
