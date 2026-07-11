import type { Metadata } from 'next'
import { getOverriddenDictionary } from '@/lib/copy-overrides'
import { getPromoterSkuPrices } from '@/lib/promoter'
import { MIGRATION_FLAT_LISTING_CAP } from '@/lib/migration-estimate'

export const metadata: Metadata = {
  title: 'Manual de migración',
  robots: { index: false },
}

/**
 * Printable consultant runbook for the `migration` promoter SKU (platform-migrations
 * epic 03 · Sprint 3 · US-3.2) — same print/handbook idiom as
 * `/vende/promotor/sell-sheet` (injected <style>, `.no-print` toolbar, noindex), but
 * its own dictionary block (`sellerAcquisition.promotorMigracion`) since the content
 * (what to photograph, interview questions, the pricing decision tree) is unique to a
 * migration close and doesn't belong on the general sell-sheet.
 */
const css = `
  @page { size: A4; margin: 14mm; }
  .ss-root { max-width: 760px; margin: 0 auto; padding: 24px 16px 64px; }
  .ss-h1 { font-size: 26px; font-weight: 800; margin: 0 0 4px; }
  .ss-sub { color: #555; margin: 0 0 20px; }
  .ss-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 16px 0; }
  .ss-card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; min-width: 0; }
  .ss-card h3 { margin: 0 0 4px; font-size: 15px; }
  .ss-card p { margin: 0; font-size: 13px; color: #444; overflow-wrap: break-word; }
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

export default async function PromoterMigracionRunbookPage() {
  const ui = (await getOverriddenDictionary('es')).sellerAcquisition
  const m = ui.promotorMigracion
  // Admin-set (platform-migrations S2) — read live, never hardcoded. Omit the price
  // line entirely (rather than show "$null") until an admin has configured one.
  const migrationPriceMxn = (await getPromoterSkuPrices()).migration ?? null

  return (
    <main className="ss-root">
      <style dangerouslySetInnerHTML={{ __html: css }} />

      <div className="no-print" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <a href="/vende/promotor/sell-sheet" style={{ textDecoration: 'underline', fontSize: 14 }}>← Volver al manual del promotor</a>
        <span style={{ color: '#888', fontSize: 13 }}>Usa Imprimir / Guardar como PDF (⌘P)</span>
      </div>

      <h1 className="ss-h1">{m.title}</h1>
      <p className="ss-sub">{m.lead}</p>

      <p className="ss-price">
        {migrationPriceMxn != null
          ? `Precio fijo: $${migrationPriceMxn} MXN, hasta ${MIGRATION_FLAT_LISTING_CAP} productos. Catálogos más grandes reciben una cotización — ver abajo.`
          : `El precio fijo de migración aún no está configurado (Panel de admin → Promotores). Hasta ${MIGRATION_FLAT_LISTING_CAP} productos usa precio fijo; catálogos más grandes reciben una cotización.`}
      </p>

      <h2 style={{ fontSize: 16 }}>{m.photoTitle}</h2>
      <div className="ss-grid">
        {m.photo.map((item) => (
          <div key={item.title} className="ss-card">
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 16 }}>{m.interviewTitle}</h2>
      <div className="ss-grid">
        {m.interview.map((item) => (
          <div key={item.title} className="ss-card">
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 16 }}>{m.runTitle}</h2>
      <ul className="ss-steps">
        {m.run.map((s) => (
          <li key={s.title}><strong>{s.title}.</strong> {s.body}</li>
        ))}
      </ul>

      <h2 style={{ fontSize: 16 }}>{m.decisionTitle}</h2>
      <div className="ss-grid">
        {m.decision.map((item) => (
          <div key={item.title} className="ss-card">
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </div>
        ))}
      </div>
    </main>
  )
}
