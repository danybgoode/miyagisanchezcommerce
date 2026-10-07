'use client'

import { useMemo, useState } from 'react'
import { claimLinkAvailability, selectClaimLinkShops, type ClaimLinkScope } from '@/lib/admin/claim-link-directory'
import type { TenantFilter, TenantRow, TenantSortKey, SortDirection } from '@/lib/admin/tenant-directory'
import { sellerStatusLabel } from '@/lib/seller-status'
import { ADMIN_LIST_FIRST_PAGE, paginate } from '@/lib/admin-pagination'
import AdminPagination from '../_components/AdminPagination'

type Directory = { state: 'resolved'; rows: TenantRow[] } | { state: 'unavailable' }
type Links = { shopName: string; previewUrl: string; claimUrl: string }
const PAGE_SIZE = 25
const EMPTY_ROWS: TenantRow[] = []

export default function ClaimLinksClient({ directory }: { directory: Directory }) {
  const rows = directory.state === 'resolved' ? directory.rows : EMPTY_ROWS
  const [scope, setScope] = useState<ClaimLinkScope>('unclaimed')
  const [filter, setFilter] = useState<TenantFilter>({})
  const [sort, setSort] = useState<{ key: TenantSortKey; direction: SortDirection }>({ key: 'listings', direction: 'desc' })
  const [page, setPage] = useState(ADMIN_LIST_FIRST_PAGE)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [links, setLinks] = useState<Links | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<'preview' | 'claim' | null>(null)

  const readyCount = useMemo(() => rows.filter((row) => claimLinkAvailability(row).ready).length, [rows])
  const selected = useMemo(() => selectClaimLinkShops(rows, scope, filter, sort), [rows, scope, filter, sort])
  const pagination = useMemo(() => paginate(selected, page, PAGE_SIZE), [selected, page])

  function changeScope(next: ClaimLinkScope) { setScope(next); setPage(ADMIN_LIST_FIRST_PAGE) }
  function changeFilter(patch: Partial<TenantFilter>) { setFilter((current) => ({ ...current, ...patch })); setPage(ADMIN_LIST_FIRST_PAGE) }
  function changeSort(key: TenantSortKey) {
    setSort({ key, direction: key === 'name' ? 'asc' : 'desc' })
    setPage(ADMIN_LIST_FIRST_PAGE)
  }

  async function createLinks(row: TenantRow) {
    if (!row.operatingMarketCode || !claimLinkAvailability(row).ready) return
    setSelectedId(row.shopId)
    setBusy(true)
    setError('')
    setLinks(null)
    setCopied(null)
    try {
      const response = await fetch('/api/admin/claim-links', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopSlug: row.slug, market: row.operatingMarketCode }),
      })
      const data = await response.json() as Links & { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'No pudimos preparar los enlaces.')
      setLinks(data)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos preparar los enlaces.')
    } finally { setBusy(false) }
  }

  async function copy(value: string, kind: 'preview' | 'claim') {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      setError('')
    } catch { setError('No se pudo copiar. Selecciona el enlace y cópialo manualmente.') }
  }

  return <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
    <div>
      <h1 className="text-2xl font-bold">Enlaces de reclamación</h1>
      <p className="mt-1 max-w-3xl text-sm text-[var(--color-muted)]">
        Elige una tienda para preparar los dos enlaces de tu correo personal: su vista pública y la reclamación. Esta página no envía mensajes.
      </p>
    </div>

    {directory.state === 'unavailable' ? (
      <div role="alert" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4 text-sm">
        No pudimos cargar las tiendas. Actualiza la página para intentarlo de nuevo.
      </div>
    ) : <>
      <div className="flex flex-wrap gap-3 text-sm">
        <span className="rounded-full bg-[var(--color-bg-subtle)] px-3 py-1"><strong>{readyCount}</strong> listas para invitar</span>
        <span className="rounded-full bg-[var(--color-bg-subtle)] px-3 py-1"><strong>{rows.filter((row) => row.publicSellerClaimed === false).length}</strong> sin reclamar</span>
        <span className="rounded-full bg-[var(--color-bg-subtle)] px-3 py-1"><strong>{rows.length}</strong> tiendas en total</span>
      </div>

      <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Mostrar tiendas">
          {([['unclaimed', 'Sin reclamar'], ['ready', 'Listas para invitar'], ['all', 'Todas']] as const).map(([value, label]) =>
            <button key={value} type="button" aria-pressed={scope === value} onClick={() => changeScope(value)}
              className={scope === value ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}>{label}</button>
          )}
        </div>
        <label className="block text-xs font-medium">Buscar tienda
          <input type="search" value={filter.q ?? ''} onChange={(event) => changeFilter({ q: event.target.value })}
            placeholder="Nombre, slug, vendedor o correo de registro…"
            className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
        </label>
        <div className="flex flex-wrap gap-3 text-xs">
          <label>Mercado
            <select value={filter.market ?? 'any'} onChange={(event) => changeFilter({ market: event.target.value as TenantFilter['market'] })}
              className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1">
              <option value="any">Todos</option><option value="mx">México</option><option value="us">Estados Unidos</option><option value="unknown">Sin resolver</option>
            </select>
          </label>
          <label>Estado
            <select value={filter.status ?? 'any'} onChange={(event) => changeFilter({ status: event.target.value as TenantFilter['status'] })}
              className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1">
              <option value="any">Todos</option><option value="active">Activa</option><option value="paused">En pausa</option><option value="deleted">Eliminada</option><option value="not_imported">Sin importar</option><option value="absent">Vendedor ausente</option><option value="unavailable">No disponible</option>
            </select>
          </label>
          <label>Ordenar
            <select value={sort.key} onChange={(event) => changeSort(event.target.value as TenantSortKey)}
              className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1">
              <option value="listings">Más anuncios</option><option value="name">Nombre</option><option value="created">Más recientes</option>
            </select>
          </label>
        </div>
      </div>

      <p className="text-xs text-[var(--color-muted)]" role="status">
        {selected.length} {selected.length === 1 ? 'tienda' : 'tiendas'} · página {pagination.page} de {pagination.totalPages}
      </p>

      <div className="space-y-3">
        {pagination.pageItems.map((row) => {
          const availability = claimLinkAvailability(row)
          const previewUrl = row.operatingMarketCode && row.slug
            ? `https://miyagisanchez.com/${row.operatingMarketCode}/s/${encodeURIComponent(row.slug)}` : null
          const open = selectedId === row.shopId
          return <section key={row.shopId} className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <div className="flex flex-wrap items-start gap-3 p-4">
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">{row.name}</h2>
                <p className="break-all text-xs text-[var(--color-muted)]">/{row.slug || 'sin-slug'} · {row.medusaSellerId ?? 'Sin vendedor Medusa'}</p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-muted)]">
                  <span>{row.operatingMarketLabel}</span><span>{sellerStatusLabel(row.status)}</span>
                  <span>{row.listingCount} anuncios</span><span>{row.publicSellerClaimed === null ? 'Reclamo no disponible' : row.publicSellerClaimed ? 'Reclamada' : 'Sin reclamar'}</span>
                  <span>{row.publicSellerVerified === null ? 'Verificación no disponible' : row.publicSellerVerified ? 'Verificada' : 'No verificada'}</span>
                </div>
                <p className="mt-2 text-xs text-[var(--color-muted)]">
                  Alta: {row.createdAt ? new Date(row.createdAt).toLocaleDateString('es-MX') : 'No disponible'}
                  {' · '}Correo de registro: {row.registrationEmail === 'unavailable' || (row.publicSellerClaimed && !row.registrationEmail) ? 'No disponible' : row.registrationEmail ?? 'Sin reclamar'}
                  {row.customDomain ? ` · Dominio: ${row.customDomain}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {previewUrl && <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">Ver tienda ↗</a>}
                {availability.ready
                  ? <button type="button" disabled={busy} onClick={() => void createLinks(row)} className="btn btn-primary btn-sm">{busy && open ? 'Preparando…' : 'Preparar enlaces'}</button>
                  : <span className="rounded-full bg-[var(--color-bg-subtle)] px-3 py-1 text-xs">{availability.reason}</span>}
              </div>
            </div>
            {open && (busy || error || links) && <div className="space-y-3 border-t border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4">
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
              {links && <>
                <p className="text-sm font-medium">Enlaces de {links.shopName}</p>
                <LinkField id="preview" label="Ver la tienda" value={links.previewUrl} copied={copied === 'preview'} onCopy={() => void copy(links.previewUrl, 'preview')} />
                <LinkField id="claim" label="Reclamar la tienda" value={links.claimUrl} copied={copied === 'claim'} onCopy={() => void copy(links.claimUrl, 'claim')} />
                <p className="text-xs text-[var(--color-muted)]">Quien tenga el enlace de reclamación puede tomar esta tienda con cualquier cuenta mientras siga sin dueño. Comprueba el destinatario antes de enviarlo.</p>
              </>}
            </div>}
          </section>
        })}
        {selected.length === 0 && <p className="rounded-lg border border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-muted)]">No hay tiendas con estos filtros.</p>}
      </div>
      <AdminPagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={setPage} />
    </>}
  </div>
}

function LinkField({ id, label, value, copied, onCopy }: { id: string; label: string; value: string; copied: boolean; onCopy: () => void }) {
  return <div>
    <label className="text-xs font-medium" htmlFor={`claim-link-${id}`}>{label}</label>
    <div className="mt-1 flex gap-2">
      <input id={`claim-link-${id}`} readOnly value={value} onFocus={(event) => event.currentTarget.select()}
        className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs" />
      <button type="button" onClick={onCopy} className="btn btn-secondary btn-sm">{copied ? 'Copiado' : 'Copiar'}</button>
    </div>
  </div>
}
