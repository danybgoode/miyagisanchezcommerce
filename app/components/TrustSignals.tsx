/**
 * app/components/TrustSignals.tsx
 *
 * Trust & Messaging Polish (#3c · Epic C) — Sprint 2, C.4.
 *
 * The shared, channel-aware trust block. Extracted from the inline PDP signals
 * (`app/l/[id]/page.tsx`) so trust no longer depends on which page a listing renders on.
 * Pure presentational (no hooks, no `'use client'`) → composes inside Server Components;
 * the `consultCta` slot may itself carry client components (e.g. `<AskSellerButton>`).
 *
 * Which signals show per (channel, variant) is decided by the pure seam
 * `lib/trust-signals.ts` (`selectTrustSignals`) — the single source of truth.
 *
 * ── Contract (handed to Epic D · cross-channel-trust-parity) ──────────────────────────
 *   <TrustSignals
 *     channel?            // ChannelSource (lib/channel.ts); default 'marketplace'
 *     variant?            // 'full' (PDP block) | 'slim' (negotiation capsule); default 'full'
 *     paymentMethods      // TrustMethod[]  — [{ icon, label, note }]
 *     fulfillmentMethods  // TrustMethod[]
 *     processingLabel     // string | null
 *     returnsLabel        // string | null
 *     verified?           // boolean — slim only (shop.verified)
 *     paymentProtected?   // boolean — slim only (any online card rail)
 *     consultCta?         // ReactNode — full only, the "precio a consultar" slot
 *   />
 * Epic D renders this in `ChannelLayout` / embed (NOT wired here — that is Epic D's slice).
 * Parity-first: the marketplace `full` variant is byte-for-byte the previous PDP DOM.
 */

import type { ReactNode } from 'react'
import type { ChannelSource } from '@/lib/channel'
import {
  selectTrustSignals,
  TRUST_COPY,
  type TrustMethod,
  type TrustVariant,
} from '@/lib/trust-signals'

export interface TrustSignalsProps {
  channel?: ChannelSource
  variant?: TrustVariant
  paymentMethods: TrustMethod[]
  fulfillmentMethods: TrustMethod[]
  processingLabel: string | null
  returnsLabel: string | null
  verified?: boolean
  paymentProtected?: boolean
  /** Full variant only: the "precio a consultar" / AskSellerButton block (kept in the page). */
  consultCta?: ReactNode
  /**
   * Full variant only: a slot rendered *between* the order-info pills and the methods box.
   * The PDP passes its mobile `<SellerTrustCard>` here so S3.2's ordering is preserved
   * byte-for-byte; Epic D passes nothing.
   */
  interstitial?: ReactNode
}

function MethodGrid({ heading, methods, marginBottom }: { heading: string; methods: TrustMethod[]; marginBottom: number }) {
  return (
    <div style={{ marginBottom }}>
      <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{heading}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: 8 }}>
        {methods.map(method => (
          <div key={method.label} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 'var(--r-md)', background: 'var(--bg-sunk)' }}>
            <i className={method.icon} style={{ fontSize: 15, color: 'var(--accent)', flexShrink: 0 }} />
            <div className="min-w-0">
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg)' }}>{method.label}</p>
              <p style={{ fontSize: 11, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{method.note}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function TrustSignals(props: TrustSignalsProps) {
  const variant = props.variant ?? 'full'
  const vis = selectTrustSignals({
    channel: props.channel,
    variant,
    hasPayment: props.paymentMethods.length > 0,
    hasFulfillment: props.fulfillmentMethods.length > 0,
    processingLabel: props.processingLabel,
    returnsLabel: props.returnsLabel,
    verified: props.verified,
    paymentProtected: props.paymentProtected,
  })

  // ── Slim — the negotiation-entry capsule (C.5) ──────────────────────────────────────
  if (variant === 'slim') {
    const chips: ReactNode[] = []
    if (vis.showVerified) {
      chips.push(
        <span key="verified" style={{ fontSize: 12, background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: 'var(--r-pill)', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <i className="iconoir-check-circle" style={{ fontSize: 11 }} />
          {TRUST_COPY.verified}
        </span>,
      )
    }
    if (vis.showProtection) {
      chips.push(
        <span key="protection" style={{ fontSize: 12, background: 'var(--bg-sunk)', color: 'var(--fg-muted)', borderRadius: 'var(--r-pill)', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <i className="iconoir-shield-check" style={{ fontSize: 11 }} />
          {TRUST_COPY.protection}
        </span>,
      )
    }
    if (vis.showReturnsPill && props.returnsLabel) {
      chips.push(
        <span key="returns" style={{ fontSize: 12, background: 'var(--success-soft)', color: 'var(--success)', borderRadius: 'var(--r-pill)', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <i className="iconoir-undo" style={{ fontSize: 11 }} />
          {TRUST_COPY.returns(props.returnsLabel)}
        </span>,
      )
    }
    if (chips.length === 0) return null
    return (
      <div data-testid="trust-signals-slim" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {chips}
      </div>
    )
  }

  // ── Full — the PDP block (parity-first, byte-for-byte the previous DOM) ──────────────
  const showPills = vis.showProcessingPill || vis.showReturnsPill
  const showBox = vis.showPaymentGrid || vis.showFulfillmentGrid || !!props.consultCta

  return (
    <>
      {/* Order info pills */}
      {showPills && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          {vis.showProcessingPill && (
            <span style={{ fontSize: 12, background: 'var(--bg-sunk)', color: 'var(--fg-muted)', borderRadius: 'var(--r-pill)', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <i className="iconoir-box" style={{ fontSize: 11 }} />
              Lista en {props.processingLabel}
            </span>
          )}
          {vis.showReturnsPill && (
            <span style={{ fontSize: 12, background: 'var(--success-soft)', color: 'var(--success)', borderRadius: 'var(--r-pill)', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <i className="iconoir-undo" style={{ fontSize: 11 }} />
              Devoluciones: {props.returnsLabel}
            </span>
          )}
        </div>
      )}

      {props.interstitial}

      {showBox && (
        <div data-testid="pdp-methods" style={{ marginBottom: 16, padding: '14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
          {props.consultCta}
          {vis.showPaymentGrid && (
            <MethodGrid heading="Métodos disponibles" methods={props.paymentMethods} marginBottom={vis.showFulfillmentGrid ? 12 : 0} />
          )}
          {vis.showFulfillmentGrid && (
            <MethodGrid heading="Entrega y disponibilidad" methods={props.fulfillmentMethods} marginBottom={0} />
          )}
        </div>
      )}
    </>
  )
}
