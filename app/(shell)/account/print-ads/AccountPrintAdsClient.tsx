'use client'

import { BuyerCopyText, useBuyerFormatters } from '@/app/components/BuyerPresentationContext'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import PrintAdPreview from '@/app/components/PrintAdPreview'
import CopyButton from '@/app/components/CopyButton'
import type { PrintAdSubmission, PrintSubmissionStatus, PrintTier } from '@/lib/print'

type Row = PrintAdSubmission & {
  print_editions?: {
    title?: string
    status?: string
    distribution_date?: string | null
    submission_deadline?: string | null
    tiers?: PrintTier[]
  } | null
}

const STATUS: Record<PrintSubmissionStatus, { label: string; cls: string }> = {
  draft:           { label: 'Borrador',       cls: 'bg-gray-100 text-gray-600' },
  pending_payment: { label: 'Pago pendiente', cls: 'bg-amber-100 text-amber-700' },
  paid:            { label: 'En revisión',    cls: 'bg-blue-100 text-blue-700' },
  approved:        { label: 'Aprobado',       cls: 'bg-green-100 text-green-700' },
  placed:          { label: 'Publicado',      cls: 'bg-emerald-100 text-emerald-700' },
  rejected:        { label: 'Necesita cambios', cls: 'bg-red-100 text-red-600' },
  refunded:        { label: 'Reembolsado',    cls: 'bg-gray-100 text-gray-500' },
}

export default function AccountPrintAdsClient() {
  const formatters = useBuyerFormatters()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/print/submissions')
      .then((r) => (r.ok ? r.json() : { submissions: [] }))
      .then((d) => setRows(d.submissions ?? []))
      .catch(() => setRows([]))
  }, [])
  useEffect(() => { load() }, [load])

  async function reportPaid(id: string) {
    setBusyId(id)
    const res = await fetch(`/api/print/submissions/${id}/payment-reported`, { method: 'POST' })
    setBusyId(null)
    setToast(res.ok ? 'Gracias, avisamos a Miyagi para confirmar tu pago.' : 'No se pudo enviar el aviso.')
    if (res.ok) load()
  }

  async function requestChanges(id: string) {
    const message = window.prompt('¿Qué te gustaría cambiar de tu anuncio?')
    if (!message) return
    setBusyId(id)
    const res = await fetch(`/api/print/submissions/${id}/change-request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
    })
    setBusyId(null)
    setToast(res.ok ? 'Enviamos tu solicitud de cambios.' : 'No se pudo enviar la solicitud.')
  }

  if (rows === null) return <div className="max-w-2xl mx-auto px-4 py-12 text-sm text-[var(--color-muted)]"><BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.44aa66ee" /></div>

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold"><BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.36c80352" /></h1>
      <p className="text-sm text-[var(--color-muted)] mb-6"><BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.276d3216" /></p>

      {rows.length === 0 ? (
        <div className="border-2 border-dashed border-[var(--color-border)] rounded-xl p-10 text-center">
          <div className="text-4xl mb-3"><i className="iconoir-journal" aria-hidden /></div>
          <p className="text-sm text-[var(--color-muted)] mb-4"><BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.07fc12f3" /></p>
          <Link href="/shop/manage" className="inline-block bg-[var(--color-accent)] text-white px-5 py-2 rounded-lg text-sm font-semibold no-underline">
            <BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.c56f35f9" /></Link>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((s) => {
            const ed = s.print_editions
            const tierLabel = (ed?.tiers ?? []).find((t) => t.key === s.tier_key)?.label ?? s.tier_key
            const chip = STATUS[s.status] ?? STATUS.draft
            const manual = s.content?.manual_payment as
              | { spei?: { clabe?: string; bank_name?: string; account_holder?: string }; dimo?: { phone?: string }; cash?: { note?: string } }
              | undefined
            const distrib = ed?.distribution_date ? formatters.date(ed.distribution_date, { day: 'numeric', month: 'long' }) : null
            const deadline = ed?.submission_deadline ? formatters.date(ed.submission_deadline, { day: 'numeric', month: 'long' }) : null
            return (
              <div key={s.id} className="border border-[var(--color-border)] rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h2 className="font-semibold">{ed?.title ?? <BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.5ac61180" />}</h2>
                    <p className="text-xs text-[var(--color-muted)]">{tierLabel}{distrib && <BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.84d366f8" values={[distrib]} />}</p>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${chip.cls}`}>{chip.label}</span>
                </div>

                <PrintAdPreview content={s.content ?? {}} tierLabel={tierLabel} />

                {/* Status-specific guidance + actions */}
                <div className="mt-3 space-y-3">
                  {(s.status === 'draft') && (
                    <Link href={`/sell/print/${s.edition_id}?submission=${s.id}`} className="inline-block bg-[var(--color-accent)] text-white px-4 py-2 rounded-lg text-sm font-semibold no-underline">
                      <BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.f662bc83" /></Link>
                  )}

                  {s.status === 'pending_payment' && (
                    <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm">
                      <div className="font-semibold text-amber-800 mb-1"><BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.6a1c03e4" />{deadline && <BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.733d88c4" values={[deadline]} />}</div>
                      {manual?.spei?.clabe ? (
                        <div className="text-amber-900 space-y-0.5">
                          <div className="flex items-center gap-2"><BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.af040adc" />{' '}<strong>{manual.spei.clabe}</strong><CopyButton value={manual.spei.clabe} /></div>
                          {manual.spei.bank_name && <div><BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.7b05c4b0" />{' '}{manual.spei.bank_name}</div>}
                          {manual.spei.account_holder && <div><BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.22fe0cf1" />{' '}{manual.spei.account_holder}</div>}
                        </div>
                      ) : manual?.dimo?.phone ? (
                        <div className="text-amber-900 flex items-center gap-2"><BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.60c55210" />{' '}<strong>{manual.dimo.phone}</strong><CopyButton value={manual.dimo.phone} /></div>
                      ) : (
                        <div className="text-amber-900"><BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.811a0c2a" /></div>
                      )}
                      <button onClick={() => reportPaid(s.id)} disabled={busyId === s.id || s.content?.payment_reported === true}
                        className="mt-2 bg-amber-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50">
                        {s.content?.payment_reported ? <><i className="iconoir-check" aria-hidden /> <BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.c71c9700" /></> : <BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.54338100" />}
                      </button>
                    </div>
                  )}

                  {s.status === 'paid' && <p className="text-sm text-[var(--color-muted)]"><BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.7415d99e" /></p>}
                  {s.status === 'approved' && <p className="text-sm text-green-700"><i className="iconoir-check-circle" aria-hidden /> <BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.6615fba0" />{distrib && <BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.4061edb3" values={[distrib]} />}.</p>}
                  {s.status === 'placed' && <p className="text-sm text-emerald-700"><i className="iconoir-journal" aria-hidden /> <BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.6064530a" /></p>}

                  {s.status === 'rejected' && (
                    <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm">
                      <div className="font-semibold text-red-700 mb-1"><BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.36532191" /></div>
                      {s.admin_notes && <p className="text-red-900 mb-2">{s.admin_notes}</p>}
                      <Link href={`/sell/print/${s.edition_id}?submission=${s.id}`} className="inline-block bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold no-underline">
                        <BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.4e4ccd5b" /></Link>
                    </div>
                  )}

                  {(s.status === 'paid' || s.status === 'approved') && (
                    <button onClick={() => requestChanges(s.id)} disabled={busyId === s.id}
                      className="text-xs text-[var(--color-muted)] underline disabled:opacity-50">
                      <BuyerCopyText copyKey="account.print.ads.AccountPrintAdsClient.5d0087bd" /></button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[var(--color-foreground)] text-[var(--color-background)] text-sm px-4 py-2 rounded-lg shadow-lg" onAnimationEnd={() => setToast(null)}>
          {toast}
          <button onClick={() => setToast(null)} className="ml-3 opacity-70">×</button>
        </div>
      )}
    </div>
  )
}
