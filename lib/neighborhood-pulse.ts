import type { PrintSocialStatus } from '@/lib/print'

export const NEIGHBORHOOD_PULSE_SOCIAL_STATUSES = ['approved', 'placed'] as const satisfies readonly PrintSocialStatus[]

const ADMIN_SOCIAL_STATUSES = ['submitted', 'approved', 'placed', 'rejected'] as const satisfies readonly PrintSocialStatus[]

export type PrintSocialAdminPatchResult =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isNeighborhoodPulseSocialItem(item: { status?: unknown; web_visible?: unknown }): boolean {
  return item.web_visible === true && (NEIGHBORHOOD_PULSE_SOCIAL_STATUSES as readonly string[]).includes(String(item.status))
}

export function buildPrintSocialAdminPatch(body: unknown): PrintSocialAdminPatchResult {
  if (!isRecord(body)) return { ok: false, error: 'Invalid body' }

  const patch: Record<string, unknown> = {}

  if ('status' in body && body.status) {
    if (typeof body.status !== 'string' || !ADMIN_SOCIAL_STATUSES.includes(body.status as PrintSocialStatus)) {
      return { ok: false, error: 'Invalid status' }
    }
    patch.status = body.status
  }

  if ('edition_id' in body) {
    patch.edition_id = typeof body.edition_id === 'string' && body.edition_id ? body.edition_id : null
  }

  if (typeof body.admin_notes === 'string') {
    patch.admin_notes = body.admin_notes
  }

  if ('web_visible' in body) {
    if (typeof body.web_visible !== 'boolean') return { ok: false, error: 'Invalid web_visible' }
    patch.web_visible = body.web_visible
  }

  if (Object.keys(patch).length === 0) return { ok: false, error: 'Nothing to update' }
  return { ok: true, patch }
}
