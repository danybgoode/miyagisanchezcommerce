'use client'

/** On-screen-only toolbar for the print view (hidden via .no-print at @media print). */
export default function PrintToolbar({ backHref }: { backHref: string }) {
  return (
    <div className="no-print" style={{ position: 'fixed', top: 12, left: 12, right: 12, zIndex: 10000, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <a href={backHref} style={{ color: '#fff', fontSize: 13, textDecoration: 'none', background: 'rgba(0,0,0,.5)', padding: '6px 12px', borderRadius: 8 }}>← Volver a la maqueta</a>
      <button onClick={() => window.print()} style={{ background: '#0a4d2e', color: '#fff', fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 8, border: 0, cursor: 'pointer' }}>
        🖨 Guardar PDF / Imprimir
      </button>
      <span style={{ color: '#fff', fontSize: 12, opacity: 0.85 }}>
        En el diálogo: activa <strong>“Gráficos de fondo”</strong>, márgenes <strong>“Ninguno”</strong> y el tamaño de papel correcto.
      </span>
    </div>
  )
}
