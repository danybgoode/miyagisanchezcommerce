'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { useCart } from '@/app/components/CartContext'
import CheckoutExperience from '@/app/checkout/CheckoutExperience'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(cents: number, currency: string) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100)
}

// ── Main component ────────────────────────────────────────────────────────────
//
// A bundle is just a multi-line-item cart for one seller. It renders the SAME
// CheckoutExperience as single-item checkout — the only difference is the item
// count. All delivery + payment options come from Medusa via checkout-options.

export default function BundleCheckoutClient() {
  const searchParams = useSearchParams()
  const requestedSellerId = searchParams.get('sellerId')
  const { isSignedIn } = useUser()
  const { itemsBySeller, removeItem, clearSeller } = useCart()

  const sellerIds = Array.from(itemsBySeller.keys())
  const sellerId = requestedSellerId && itemsBySeller.has(requestedSellerId)
    ? requestedSellerId
    : sellerIds[0]
  const items = sellerId ? (itemsBySeller.get(sellerId) ?? []) : []
  const seller = items[0]
  const subtotal = items.reduce((sum, item) => sum + item.price_cents, 0)
  const currency = seller?.currency ?? 'MXN'
  const returnPath = `/checkout/bundle${sellerId ? `?sellerId=${encodeURIComponent(sellerId)}` : ''}`
  const currencyMismatch = items.some(item => item.currency !== currency)

  if (!isSignedIn) {
    return (
      <main className="max-w-[640px] mx-auto px-4 py-8">
        <Link href="/l" style={{ fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none' }}>← Explorar</Link>
        <section style={{ marginTop: 18, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 20, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Inicia sesión para comprar tu paquete</h1>
          <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 6 }}>Guardamos tu selección y te regresamos aquí para revisar antes de pagar.</p>
          <Link href={`/sign-in?redirect_url=${encodeURIComponent(returnPath)}`} className="btn btn-dark btn-lg no-underline" style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}>
            Iniciar sesión
          </Link>
        </section>
      </main>
    )
  }

  if (items.length === 0) {
    return (
      <main className="max-w-[640px] mx-auto px-4 py-8">
        <Link href="/l" style={{ fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none' }}>← Explorar</Link>
        <section style={{ marginTop: 18, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 20, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Tu paquete está vacío</h1>
          <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 6 }}>Agrega artículos de una misma tienda para revisar el paquete.</p>
          <Link href="/l" className="btn btn-dark btn-lg no-underline" style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}>Ver anuncios</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="max-w-[760px] mx-auto px-4 py-5 md:py-8">
      <div style={{ marginBottom: 18 }}>
        <Link href={`/s/${seller.sellerSlug}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none' }}>
          <i className="iconoir-arrow-left" style={{ fontSize: 16 }} />
          Volver a la tienda
        </Link>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        {/* Multi-seller switcher */}
        {sellerIds.length > 1 && (
          <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 12 }}>
            <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 8 }}>Tienes paquetes de varias tiendas. Elige uno para pagar.</p>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
              {sellerIds.map(id => {
                const group = itemsBySeller.get(id) ?? []
                const active = id === sellerId
                const total = group.reduce((sum, item) => sum + item.price_cents, 0)
                return (
                  <Link key={id} href={`/checkout/bundle?sellerId=${encodeURIComponent(id)}`} className="no-underline"
                    style={{ flexShrink: 0, minWidth: 160, padding: 10, borderRadius: 'var(--r-md)',
                      border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      background: active ? 'var(--accent-soft)' : 'var(--bg-sunk)', color: 'var(--fg)' }}>
                    <p style={{ fontSize: 13, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group[0]?.sellerName ?? 'Tienda'}</p>
                    <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>{group.length} artículo{group.length === 1 ? '' : 's'} · {fmt(total, group[0]?.currency ?? 'MXN')}</p>
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        {/* Item list */}
        <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
          <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
            <p style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>Paquete de {seller.sellerName}</p>
            <h1 style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>Revisar paquete</h1>
            <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 4 }}>Compra varios artículos del mismo vendedor en un solo pago.</p>
          </div>

          <div style={{ display: 'grid' }}>
            {items.map(item => (
              <div key={item.productId} style={{ display: 'flex', gap: 12, padding: 14, borderBottom: '1px solid var(--border)' }}>
                <Link href={`/l/${item.productId}`} style={{ width: 68, height: 68, borderRadius: 8, overflow: 'hidden', background: 'var(--bg-sunk)', flexShrink: 0 }}>
                  {item.imageUrl ? <img src={item.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : null}
                </Link>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{item.title}</p>
                  <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 3 }}>{fmt(item.price_cents, item.currency)}</p>
                </div>
                <button type="button" onClick={() => removeItem(item.productId)} aria-label="Quitar del paquete"
                  style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'var(--bg-sunk)', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="iconoir-xmark" style={{ fontSize: 15 }} />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Currency guard, then the SAME checkout experience as single items */}
        {currencyMismatch ? (
          <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16 }}>
            <p style={{ fontSize: 13, color: 'var(--danger)' }}>
              Este paquete mezcla monedas. Quita artículos hasta que todos tengan la misma moneda.
            </p>
          </section>
        ) : (
          sellerId && (
            <CheckoutExperience
              items={items}
              sellerId={sellerId}
              amountCents={subtotal}
              currency={currency}
              listingType="product"
              isDigital={false}
              onStarted={() => clearSeller(sellerId)}
            />
          )
        )}
      </div>
    </main>
  )
}
