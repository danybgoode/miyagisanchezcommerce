'use client'

import { useState } from 'react'

type Links = { shopName: string; previewUrl: string; claimUrl: string }

export default function ClaimLinksClient() {
  const [shopSlug, setShopSlug] = useState('')
  const [market, setMarket] = useState<'mx' | 'us'>('mx')
  const [links, setLinks] = useState<Links | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function createLinks(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError(''); setLinks(null)
    try {
      const res = await fetch('/api/admin/claim-links', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopSlug, market }),
      })
      const data = await res.json() as Links & { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'No pudimos preparar los enlaces.')
      setLinks(data)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No pudimos preparar los enlaces.') }
    finally { setBusy(false) }
  }

  return <main className="mx-auto max-w-2xl px-5 py-12">
    <h1 className="text-2xl font-bold">Enlaces para reclamar una tienda</h1>
    <p className="mt-3 text-sm text-[var(--color-muted)]">Prepara dos enlaces para tu correo personal. Esta página no envía mensajes. El enlace de reclamación sirve hasta que se reclame la tienda.</p>
    <form onSubmit={createLinks} className="mt-8 grid gap-4">
      <label className="grid gap-1 text-sm font-medium">Identificador de la tienda
        <input required value={shopSlug} onChange={event => setShopSlug(event.target.value)} className="rounded border border-[var(--color-border)] px-3 py-2" placeholder="terrumaco" />
      </label>
      <label className="grid gap-1 text-sm font-medium">Mercado
        <select value={market} onChange={event => setMarket(event.target.value as 'mx' | 'us')} className="rounded border border-[var(--color-border)] px-3 py-2"><option value="mx">México</option><option value="us">Estados Unidos</option></select>
      </label>
      <button disabled={busy} className="btn btn-primary justify-self-start">{busy ? 'Preparando…' : 'Crear enlaces'}</button>
    </form>
    {error && <p className="mt-5 text-red-700" role="alert">{error}</p>}
    {links && <section className="mt-8 space-y-5" role="status">
      <h2 className="font-semibold">{links.shopName}</h2>
      {([['Ver la tienda', links.previewUrl], ['Reclamar la tienda', links.claimUrl]] as const).map(([label, value]) => <div key={label}>
        <label className="block text-sm font-medium" htmlFor={label}>{label}</label>
        <div className="mt-1 flex gap-2"><input id={label} readOnly value={value} className="min-w-0 flex-1 rounded border border-[var(--color-border)] px-3 py-2 text-xs" /><button type="button" onClick={() => void navigator.clipboard.writeText(value)} className="rounded border border-[var(--color-border)] px-3 text-sm">Copiar</button></div>
      </div>)}
      <p className="text-sm text-[var(--color-muted)]">Cualquier persona con el enlace puede reclamar esta tienda con cualquier cuenta mientras siga sin dueño.</p>
    </section>}
  </main>
}
