/**
 * lib/announcements-merge.ts
 *
 * The PURE decision seam (epic 08 · admin-content-and-announcements, Sprint 3) for the
 * announcement primitive — schedule/status resolution and the one-active-per-audience
 * activation decision. Kept free of `next/*` and `server-only` (mirrors
 * `lib/copy-overrides-merge.ts` / `lib/flags-cache.ts`) so it's unit-testable with zero
 * network. `lib/announcements.ts` composes `resolveActiveAnnouncement`, binding the real
 * Supabase/flags dependencies; `app/api/admin/announcements/route.ts` composes
 * `decideActivationConflict` for the write path.
 */

export type Audience = 'seller' | 'buyer'

/** One row of the `platform_announcements` table. */
export interface AnnouncementRow {
  id: string
  audience: Audience
  text: string
  ctaLabel: string | null
  ctaLink: string | null
  startsAt: string | null
  endsAt: string | null
  active: boolean
}

export type AnnouncementStatus = 'programado' | 'activo' | 'expirado' | 'inactivo'

/**
 * Derive the admin-facing status from the schedule + `active` toggle — never stored,
 * always computed against `now`. `active=false` is always `inactivo` regardless of
 * schedule (deactivating hides a campaign for everyone, no matter its dates).
 */
export function resolveAnnouncementStatus(row: AnnouncementRow, now: number): AnnouncementStatus {
  if (!row.active) return 'inactivo'
  const starts = row.startsAt ? Date.parse(row.startsAt) : null
  const ends = row.endsAt ? Date.parse(row.endsAt) : null
  if (starts !== null && now < starts) return 'programado'
  if (ends !== null && now >= ends) return 'expirado'
  return 'activo'
}

/**
 * The single row (if any) that should render for `audience` right now — i.e. active
 * AND within its schedule window. One-active-per-audience is enforced at write time
 * (DB partial unique index + `decideActivationConflict`), so at most one row should
 * ever qualify here; if more than one somehow does (a defensive case, not a normal
 * path), the first match wins rather than the read throwing.
 */
export function resolveActiveAnnouncement(
  rows: readonly AnnouncementRow[],
  audience: Audience,
  now: number,
): AnnouncementRow | null {
  return rows.find((r) => r.audience === audience && resolveAnnouncementStatus(r, now) === 'activo') ?? null
}

export type ActivationDecision =
  | { ok: true; deactivateId: string | null }
  | { ok: false; conflict: AnnouncementRow }

/**
 * Pure one-active-per-audience decision for the write route. Only matters when the
 * incoming write wants `active: true` — an inactive write never conflicts with anything.
 * `excludeId` is the row being updated (if editing an existing campaign), so a
 * campaign doesn't conflict with itself.
 */
export function decideActivationConflict(
  rows: readonly AnnouncementRow[],
  audience: Audience,
  opts: { active: boolean; excludeId?: string | null; replaceExisting?: boolean },
): ActivationDecision {
  if (!opts.active) return { ok: true, deactivateId: null }

  const existing = rows.find(
    (r) => r.audience === audience && r.active && r.id !== (opts.excludeId ?? undefined),
  )
  if (!existing) return { ok: true, deactivateId: null }
  if (!opts.replaceExisting) return { ok: false, conflict: existing }
  return { ok: true, deactivateId: existing.id }
}
