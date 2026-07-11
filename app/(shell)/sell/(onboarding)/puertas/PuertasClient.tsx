'use client'

import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { setOnboardingSkipSignal } from '@/lib/onboarding-skip'
import type { DoorKey } from '@/lib/onboarding-personalization'

interface DoorMeta {
  icon: string
  title: string
  estimate: string
  body: string
  href: string
  /** Door 3 shares the SellWizard entry with the ghost "explore on my own"
   *  CTA — clicking it means the same thing: opt out of the guided flow. */
  isSkipTarget?: boolean
}

const DOOR_META: Record<DoorKey, DoorMeta> = {
  agent: {
    icon: 'iconoir-sparks',
    title: 'Empezar con mi agente',
    estimate: '~5 min · tú solo revisas y apruebas',
    body: 'Trae tu catálogo como lo tengas — un archivo, fotos, o el prompt para tu IA. Armamos el borrador completo. Nada se publica sin tu visto bueno.',
    href: '/sell/agente',
  },
  import: {
    icon: 'iconoir-upload',
    title: 'Traer mi catálogo',
    estimate: '~10 min',
    body: 'Sube un CSV o JSON con tus productos y los revisamos juntos antes de crear tu tienda.',
    href: '/shop/manage/import',
  },
  wizard: {
    icon: 'iconoir-edit-pencil',
    title: 'Armar a mano',
    estimate: '~15 min',
    body: 'Llena el formulario paso a paso — tú controlas cada campo desde el inicio.',
    href: '/sell',
    isSkipTarget: true,
  },
}

export default function PuertasClient({ order, subtitle }: { order: DoorKey[]; subtitle: string }) {
  const router = useRouter()

  function openDoor(door: DoorKey) {
    fetch('/api/sell/tenant-intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chosenDoor: door }),
    }).catch(() => {})

    const meta = DOOR_META[door]
    if (meta.isSkipTarget) setOnboardingSkipSignal()
    router.push(meta.href)
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 0 48px' }}>
      <h1 className="text-2xl font-bold leading-tight">¿Cómo quieres armar tu tienda?</h1>
      <p className="text-sm text-[var(--color-muted)] mt-2">{subtitle}</p>

      <div className="flex flex-col gap-4 mt-6">
        {order.map((door) => {
          const meta = DOOR_META[door]
          const recommended = door === 'agent'
          return (
            <Card
              key={door}
              variant="panel"
              className="p-5"
              style={recommended ? { border: '2px solid var(--accent)' } : undefined}
            >
              <div className="flex items-start justify-between gap-3 mb-1">
                <h2 className="font-semibold flex items-center gap-2">
                  <i className={meta.icon} style={{ fontSize: 18 }} />
                  {meta.title}
                </h2>
                {recommended && <StatusBadge token="info">Recomendado</StatusBadge>}
              </div>
              <p className="text-xs text-[var(--color-muted)] mb-2">{meta.estimate}</p>
              <p className="text-sm text-[var(--color-muted)] mb-4">{meta.body}</p>
              <Button variant={recommended ? 'primary' : 'secondary'} onClick={() => openDoor(door)}>
                Elegir esta opción →
              </Button>
            </Card>
          )
        })}
      </div>

      <p className="text-xs text-[var(--color-muted)] text-center mt-6">
        Puedes cambiar de camino cuando quieras — nada se pierde.
      </p>
    </div>
  )
}
