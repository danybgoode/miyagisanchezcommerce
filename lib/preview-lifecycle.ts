/**
 * lib/preview-lifecycle.ts
 *
 * Founding merchant consent-safe previews · Sprint 3 — the server-side emitter for
 * preview lifecycle events (`preview_created`, `preview_delivered`,
 * `preview_approved`, `preview_invalidated`, `preview_activated`, `shop_claimed`).
 *
 * Contract, from the sprint's acceptance:
 *  - emitted ONLY AFTER the canonical write succeeds (the caller decides that —
 *    every call site sits after its own success branch),
 *  - PII-free (guaranteed by the allow-list payload builder in lib/preview-events.ts),
 *  - telemetry failure NEVER rolls back or fails the merchant/promoter action. This
 *    function therefore never throws and never returns an error: it swallows
 *    everything, exactly like lib/telegram.ts and sendGrowthEvent itself.
 *
 * Gated by `growth.telemetry_enabled` — the same flag `/api/growth/track` checks, so
 * telemetry has one on/off switch platform-wide. Golden Beans may not be live yet;
 * `sendGrowthEvent` already no-ops when unconfigured, so this degrades safely.
 */
import 'server-only'
import { isEnabled } from '@/lib/flags'
import { sendGrowthEvent } from '@/lib/growth-engine'
import {
  buildPreviewEventPayload,
  type PreviewLifecycleEvent,
  type PreviewEventFacts,
} from '@/lib/preview-events'

export type { PreviewLifecycleEvent } from '@/lib/preview-events'

/**
 * Emit one lifecycle event. Fire-and-forget by contract: awaiting it is safe (it
 * cannot throw), and ignoring the result is correct — there is nothing a caller
 * could usefully do about a telemetry failure.
 */
export async function emitPreviewEvent(
  event: PreviewLifecycleEvent,
  facts: PreviewEventFacts,
): Promise<void> {
  try {
    if (!(await isEnabled('growth.telemetry_enabled'))) return
    await sendGrowthEvent(buildPreviewEventPayload(event, facts))
  } catch {
    // Intentionally swallowed — observability must never break consent flow.
  }
}
