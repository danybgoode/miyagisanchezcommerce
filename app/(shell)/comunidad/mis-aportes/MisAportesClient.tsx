'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PRINT_SOCIAL_TYPES, type PrintSocialSubmission, type PrintSocialStatus } from '@/lib/print'

type Row = PrintSocialSubmission & { print_editions?: { title?: string } | null }

const STATUS: Record<PrintSocialStatus, { label: string; cls: string }> = {
  submitted: { label: 'En revisión', cls: 'bg-blue-100 text-blue-700' },
  approved:  { label: 'Aprobado',    cls: 'bg-green-100 text-green-700' },
  placed:    { label: 'Publicado',   cls: 'bg-emerald-100 text-emerald-700' },
  rejected:  { label: 'No incluido', cls: 'bg-gray-100 text-gray-500' },
}

export default function MisAportesClient() {
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    fetch('/api/print/social')
      .then((r) => (r.ok ? r.json() : { submissions: [] }))
      .then((d) => setRows(d.submissions ?? []))
      .catch(() => setRows([]))
  }, [])

  const typeLabel = (k: string) => PRINT_SOCIAL_TYPES.find((t) => t.key === k)?.label ?? k

  if (rows === null) return <div className="max-w-lg mx-auto px-4 py-12 text-sm text-[var(--color-muted)]">Cargando…</div>

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Mis aportes</h1>
        <Link href="/comunidad/nuevo" className="text-sm text-[var(--color-accent)] no-underline">+ Nuevo</Link>
      </div>

      {rows.length === 0 ? (
        <div className="border-2 border-dashed border-[var(--color-border)] rounded-xl p-10 text-center">
          <div className="text-4xl mb-3"><i className="iconoir-megaphone" aria-hidden /></div>
          <p className="text-sm text-[var(--color-muted)] mb-4">Aún no has compartido nada con tu colonia.</p>
          <Link href="/comunidad/nuevo" className="inline-block bg-[var(--color-accent)] text-white px-5 py-2 rounded-lg text-sm font-semibold no-underline">
            Compartir algo
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((s) => {
            const chip = STATUS[s.status] ?? STATUS.submitted
            return (
              <div key={s.id} className="border border-[var(--color-border)] rounded-xl p-3 flex gap-3">
                {s.photos?.[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.photos[0]} alt="" className="h-16 w-16 rounded-lg object-cover border border-[var(--color-border)] flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{typeLabel(s.type)}</div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${chip.cls}`}>{chip.label}</span>
                  </div>
                  <div className="font-medium text-sm">{s.caption}</div>
                  {s.body && <div className="text-xs text-[var(--color-muted)] mt-0.5 line-clamp-2">{s.body}</div>}
                  {s.print_editions?.title && <div className="text-[11px] text-green-700 mt-1">En: {s.print_editions.title}</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
