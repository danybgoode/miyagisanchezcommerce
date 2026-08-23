import { BuyerCopyText } from '@/app/components/BuyerPresentationContext'

/**
 * CollapsibleDescription — PDP redesign (epic 01) Sprint 1, S1.2.
 *
 * In the reordered PDP the description moves *above* the payment/seller blocks on
 * mobile (so the buyer understands the item before being asked to act). To keep the
 * payment box from being pushed far down by a long description, the summary keeps a
 * clamped preview and native `<details>` owns expansion. The body stays in the DOM,
 * so browser find-in-page can reveal it without a client-state toggle (D15).
 */
const CLAMP_THRESHOLD = 280

export default function CollapsibleDescription({ text }: { text: string }) {
  const isLong = text.length > CLAMP_THRESHOLD

  if (!isLong) {
    return <p style={{ fontSize: 'var(--t-sm)', color: 'var(--fg)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{text}</p>
  }

  const clipped = text.slice(0, CLAMP_THRESHOLD).trimEnd()
  // End on a word boundary. The CSS line clamp supplies its own ellipsis when
  // needed, so a manual one here would render twice on narrow screens.
  const wordBreak = Math.max(clipped.lastIndexOf(' '), clipped.lastIndexOf('\n'), clipped.lastIndexOf('\t'))
  const teaser = wordBreak > 0 ? clipped.slice(0, wordBreak).trimEnd() : clipped

  return (
    <details className="collapsible-description">
      <summary
        style={{
          cursor: 'pointer',
          color: 'var(--accent)',
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        <span
          className="collapsible-description-teaser"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 6,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            color: 'var(--fg)',
            fontSize: 'var(--t-sm)',
            fontWeight: 400,
            lineHeight: 1.6,
            whiteSpace: 'pre-line',
          }}
        >
          {teaser}
        </span>
        <span className="collapsible-description-more">
          <BuyerCopyText copyKey="l.id.CollapsibleDescription.32e540cb" />
        </span>
        <span className="collapsible-description-less">
          <BuyerCopyText copyKey="l.id.CollapsibleDescription.d587022f" />
        </span>
      </summary>
      <p
        style={{
          fontSize: 'var(--t-sm)',
          color: 'var(--fg)',
          lineHeight: 1.6,
          whiteSpace: 'pre-line',
        }}
      >
        {text}
      </p>
    </details>
  )
}
