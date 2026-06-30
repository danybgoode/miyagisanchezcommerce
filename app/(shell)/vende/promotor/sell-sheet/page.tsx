import type { Metadata } from 'next'
import { getDictionary } from '@/lib/dictionary'
import { CUSTOM_DOMAIN_PRICE_MXN } from '@/lib/domain-pricing'

export const metadata: Metadata = {
  title: 'Hoja de venta — Promotor',
  robots: { index: false },
}

/**
 * Printable promoter sell-sheet (epic 08 · S4 · US-12). A single es-MX page the
 * promoter prints / saves as PDF to use in the shop. Reuses the admin print view's
 * idiom: an injected <style> with @media print that hides the site chrome + a
 * `.no-print` toolbar. Copy comes from the same sellerAcquisition.promotor block
 * as /vende/promotor, so the two never drift.
 */
const css = `
  @page { size: A4; margin: 14mm; }
  .ss-root { max-width: 760px; margin: 0 auto; padding: 24px 16px 64px; }
  .ss-h1 { font-size: 26px; font-weight: 800; margin: 0 0 4px; }
  .ss-sub { color: #555; margin: 0 0 20px; }
  .ss-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px 0; }
  .ss-card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
  .ss-card h3 { margin: 0 0 4px; font-size: 15px; }
  .ss-card p { margin: 0; font-size: 13px; color: #444; }
  .ss-steps { margin: 16px 0; padding: 0; list-style: none; }
  .ss-steps li { margin: 0 0 10px; font-size: 14px; }
  .ss-price { font-weight: 700; }
  .no-print { margin-bottom: 16px; }
  @media print {
    html, body { background: #fff !important; }
    body > *:not(main) { display: none !important; }
    body > main { display: block !important; margin: 0 !important; padding: 0 !important; }
    .no-print { display: none !important; }
    .ss-root { max-width: none; padding: 0; }
    .ss-card { break-inside: avoid; }
  }
`

export default async function PromoterSellSheetPage() {
  const ui = (await getDictionary('es')).sellerAcquisition
  const p = ui.promotor

  return (
    <main className="ss-root">
      <style dangerouslySetInnerHTML={{ __html: css }} />

      <div className="no-print" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <a href="/vende/promotor" style={{ textDecoration: 'underline', fontSize: 14 }}>← Volver</a>
        <span style={{ color: '#888', fontSize: 13 }}>Usa Imprimir / Guardar como PDF (⌘P)</span>
      </div>

      <h1 className="ss-h1">{p.heroTitle}</h1>
      <p className="ss-sub">{p.heroLead}</p>

      <h2 style={{ fontSize: 16 }}>{p.proofTitle}</h2>
      <div className="ss-grid">
        {p.glossary.map((g) => (
          <div key={g.title} className="ss-card">
            <h3>{g.title}</h3>
            <p>{g.body}</p>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 16 }}>{p.stepsTitle}</h2>
      <ul className="ss-steps">
        {p.steps.map((s) => (
          <li key={s.title}><strong>{s.title}.</strong> {s.body}</li>
        ))}
      </ul>

      <h2 style={{ fontSize: 16 }}>{p.pitchTitle}</h2>
      <p style={{ fontSize: 14 }}>{p.pitchBody}</p>
      <p className="ss-price">
        {p.priceDomainLabel}: ${CUSTOM_DOMAIN_PRICE_MXN} MXN · {p.priceSubdomainLabel}: gratis
      </p>
    </main>
  )
}
