'use client'

import { useMemo, useState } from 'react'
import {
  filterTenants,
  entitlementReasonLabel,
  claimStatusLabel,
  domainStatusLabel,
  type TenantRow,
} from '@/lib/admin/tenant-directory'

/**
 * Read-only tenant directory (admin-consolidation · S3.1). Searches the shaped
 * rows in memory (`filterTenants`) and opens an inline inspector for one shop.
 * STRICT READ-MODEL — there are NO edit/mutate controls; the entitlement grant
 * action lands in S4. The canonical identity shown is the Medusa seller id.
 */
export default function AdminTenantsClient({ tenants }: { tenants: TenantRow[] }) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filtered = useMemo(() => filterTenants(tenants, query), [tenants, query])
  const selected = useMemo(
    () => filtered.find((t) => t.shopId === selectedId) ?? null,
    [filtered, selectedId],
  )

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Tiendas</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Directorio de solo lectura: identidad (vendedor Medusa), reclamo, dominio, plan y número
          de anuncios. Las acciones (cortesía de dominio) llegan en una entrega posterior.
        </p>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Busca por nombre, slug, dominio o id de vendedor…"
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
      />

      <p className="text-xs text-[var(--color-muted)]">
        {filtered.length} {filtered.length === 1 ? 'tienda' : 'tiendas'}
        {query ? ` (de ${tenants.length})` : ''}
      </p>

      <div className="space-y-2">
        {filtered.map((t) => {
          const open = t.shopId === selectedId
          return (
            <div key={t.shopId} className="rounded-lg border border-[var(--color-border)] overflow-hidden">
              <button
                type="button"
                onClick={() => setSelectedId(open ? null : t.shopId)}
                className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-[var(--color-bg-subtle)]"
                aria-expanded={open}
              >
                <span className="font-medium">{t.name}</span>
                <span className="text-xs text-[var(--color-muted)]">/{t.slug}</span>
                <span className="ml-auto flex items-center gap-2 text-xs">
                  <Badge tone={t.claimed ? 'ok' : 'muted'}>{claimStatusLabel(t.claimed)}</Badge>
                  <Badge tone={t.domainStatus === 'verified' ? 'ok' : t.domainStatus === 'pending' ? 'warn' : 'muted'}>
                    {domainStatusLabel(t.domainStatus)}
                  </Badge>
                  <Badge tone={t.entitled ? 'ok' : t.subscriptionUnchecked ? 'warn' : 'muted'}>
                    {t.subscriptionUnchecked ? 'Sin plan (suscripción sin verificar)' : entitlementReasonLabel(t.entitlementReason)}
                  </Badge>
                  <span className="text-[var(--color-muted)]">{t.listingCount} anuncios</span>
                </span>
              </button>

              {open && (
                <dl className="border-t border-[var(--color-border)] px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm bg-[var(--color-bg-subtle)]">
                  <Field label="Vendedor Medusa (id canónico)">
                    {t.medusaSellerId ? (
                      <code className="text-xs">{t.medusaSellerId}</code>
                    ) : (
                      <span className="text-[var(--color-muted)]">Sin vendedor Medusa (gema sin importar)</span>
                    )}
                  </Field>
                  <Field label="Slug">/{t.slug}</Field>
                  <Field label="Reclamo">{claimStatusLabel(t.claimed)}</Field>
                  <Field label="Dominio personalizado">
                    {t.customDomain ? (
                      <>
                        <code className="text-xs">{t.customDomain}</code>{' '}
                        <span className="text-[var(--color-muted)]">({domainStatusLabel(t.domainStatus)})</span>
                      </>
                    ) : (
                      <span className="text-[var(--color-muted)]">Sin dominio</span>
                    )}
                  </Field>
                  <Field label="Plan de dominio">
                    {entitlementReasonLabel(t.entitlementReason)}
                    {t.subscriptionUnchecked && (
                      <span className="block text-xs text-[var(--color-muted)] mt-0.5">
                        No se verificó la suscripción del vendedor (la verificación por vendedor llega en S4).
                      </span>
                    )}
                  </Field>
                  <Field label="Anuncios">{t.listingCount}</Field>
                  <Field label="Creada">{t.createdAt ? new Date(t.createdAt).toLocaleDateString('es-MX') : '—'}</Field>
                </dl>
              )}
            </div>
          )
        })}

        {filtered.length === 0 && (
          <p className="text-sm text-[var(--color-muted)] py-8 text-center">
            {tenants.length === 0 ? 'No hay tiendas para mostrar.' : 'Ninguna tienda coincide con tu búsqueda.'}
          </p>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-muted)]">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}

function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'muted'; children: React.ReactNode }) {
  const cls =
    tone === 'ok'
      ? 'bg-[var(--color-success-bg,#e7f6ec)] text-[var(--color-success,#1a7f37)]'
      : tone === 'warn'
        ? 'bg-[var(--color-warning-bg,#fff4e5)] text-[var(--color-warning,#9a6700)]'
        : 'bg-[var(--color-bg-subtle)] text-[var(--color-muted)]'
  return <span className={`rounded-full px-2 py-0.5 ${cls}`}>{children}</span>
}
