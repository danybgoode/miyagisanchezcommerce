import Link from 'next/link'
import { unclaimedNoticeModel } from '@/lib/unclaimed-notice'

/**
 * UnclaimedNotice — PDP redesign (epic 01) Sprint 5, S5.4.
 *
 * Honest "aún no reclamada" notice that leads an unclaimed (gem-imported) PDP, so
 * the buyer understands the status instead of seeing a store with no buy actions.
 * Buy / Offer / Cart are already suppressed upstream (`isShopClaimed`) and the
 * SellerTrustCard below carries the contact options + the same claim nudge — this
 * block only adds the honest framing at the top. No gating change.
 *
 * Presentational Server Component. Copy + claim href live in the pure
 * `unclaimedNoticeModel` seam.
 */
export default function UnclaimedNotice({ shopSlug }: { shopSlug: string }) {
  const model = unclaimedNoticeModel(shopSlug)

  return (
    <div
      data-testid="pdp-unclaimed-notice"
      style={{ background: 'var(--warning-soft)', border: '1px solid var(--warning)', borderRadius: 'var(--r-lg)', padding: 14, marginBottom: 20 }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <i className="iconoir-info-circle" style={{ fontSize: 20, color: 'var(--warning)', marginTop: 1, flexShrink: 0 }} />
        <div className="min-w-0">
          <p style={{ fontSize: 14, fontWeight: 800, color: 'var(--warning)' }}>{model.title}</p>
          <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 4, lineHeight: 1.5 }}>{model.body}</p>
          <Link
            href={model.claimHref}
            data-testid="pdp-unclaimed-claim"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 13, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none' }}
          >
            {model.claimLabel}
            <i className="iconoir-arrow-right" style={{ fontSize: 14 }} />
          </Link>
        </div>
      </div>
    </div>
  )
}
