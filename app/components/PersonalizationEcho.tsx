'use client'

import { isRenderableArtworkUrl, isImageLikeArtworkUrl } from '@/lib/personalization'

/**
 * Loosely-typed on purpose: the buyer-order and seller-order screens each
 * declare their own local `Order.personalization` shape (optional id/label/
 * value, fetched fresh from the API) rather than importing the strict
 * `PersonalizationField` from `lib/personalization.ts` — this component
 * accepts either.
 */
export interface EchoableField {
  id?: string
  label?: string
  value?: string
  type?: string
}

/**
 * Renders one personalization field the way every echo site (checkout
 * review, buyer order, seller order) needs: a plain "Label: value" text row
 * for every existing field type, or a thumbnail + "Descargar original" link
 * for the new `file` type (custom-print-products S3). `CartDrawer` and
 * `lib/email.ts` render their own compact/HTML-string variants instead of
 * this component — different enough visual contracts (truncated one-liner,
 * HTML-escaped string) that sharing would cost more props than it saves.
 */
export default function PersonalizationEcho({
  field,
  labelStyle,
  valueStyle,
}: {
  field: EchoableField
  labelStyle?: React.CSSProperties
  valueStyle?: React.CSSProperties
}) {
  const value = field.value ?? ''
  if (field.type === 'file' && isRenderableArtworkUrl(value)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {field.label && <span style={labelStyle}>{field.label}:</span>}
        {isImageLikeArtworkUrl(value) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={field.label || 'Arte del pedido'} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6 }} />
        ) : (
          <span>📄</span>
        )}
        <a href={value} target="_blank" rel="noopener noreferrer" style={{ ...valueStyle, textDecoration: 'underline' }}>
          Descargar original
        </a>
      </div>
    )
  }

  return (
    <div>
      {field.label && <span style={labelStyle}>{field.label}: </span>}
      <span style={valueStyle}>{value}</span>
    </div>
  )
}
