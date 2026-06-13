import type { Spec } from '@/lib/listing-attributes'

/**
 * Scannable, Vinted-style specs table for the PDP (PDP-redesign finding #7).
 * Renders the listing's structured per-category attributes as label/value rows
 * just above the description. Renders nothing when there are no specs, so a
 * listing without attributes shows no empty table.
 */
export default function SpecsTable({ rows }: { rows: Spec[] }) {
  if (rows.length === 0) return null

  return (
    <div style={{ marginBottom: 20 }}>
      <h2 style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Especificaciones</h2>
      <dl
        style={{
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          overflow: 'hidden',
        }}
      >
        {rows.map((row, i) => (
          <div
            key={row.label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 16,
              padding: '10px 14px',
              borderTop: i === 0 ? 'none' : '1px solid var(--border)',
            }}
          >
            <dt style={{ fontSize: 13, color: 'var(--fg-muted)', flexShrink: 0 }}>{row.label}</dt>
            <dd
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--fg)',
                margin: 0,
                textAlign: 'right',
                wordBreak: 'break-word',
              }}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
