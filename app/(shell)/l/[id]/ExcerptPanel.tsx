import { BuyerCopyText } from '@/app/components/BuyerPresentationContext'
/**
 * ExcerptPanel — the inline "Lee un adelanto" reader (bookshop launchpad S2.1).
 *
 * A collapsible free text sample shown on a digital listing's PDP. Text-only by
 * decision — no pdf.js, no images, no network — so it's byte-identical and
 * instant on mobile data. **Channel-agnostic on purpose**: it reads no channel
 * header and takes pure props, so it renders the same on the marketplace and on
 * a white-label storefront (there's no anonymous white-label PDP surface to
 * smoke-test the difference — see LEARNINGS). The full file stays private; this
 * is only the sample the seller pasted into the listing.
 */

export default function ExcerptPanel({ text }: { text: string }) {
  return (
    <details data-testid="pdp-excerpt" style={{ marginBottom: 20 }}>
      <summary
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          textAlign: 'left',
          background: 'var(--agent-soft)',
          border: 'none',
          borderRadius: 'var(--r-lg)',
          padding: 16,
          cursor: 'pointer',
        }}
      >
        <i className="iconoir-book" style={{ fontSize: 20, color: 'var(--agent)', flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 800, color: 'var(--agent)' }}>
            <BuyerCopyText copyKey="l.id.ExcerptPanel.1a9b4f90" /></span>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
            <BuyerCopyText copyKey="l.id.ExcerptPanel.a0be0648" /></span>
        </span>
        <i className="excerpt-panel-arrow iconoir-nav-arrow-down" style={{ fontSize: 20, color: 'var(--fg-muted)', flexShrink: 0 }} />
      </summary>

      <div
          style={{
            background: 'var(--bg-sunk)',
            borderRadius: 'var(--r-lg)',
            padding: 16,
            marginTop: 8,
            fontSize: 'var(--t-base)',
            lineHeight: 1.7,
            color: 'var(--fg)',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
          }}
        >
          {text}
      </div>
    </details>
  )
}
