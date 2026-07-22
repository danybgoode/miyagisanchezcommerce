/**
 * lib/preview-consent.ts
 *
 * Founding merchant consent-safe previews · Sprint 2 — the consent RECORD: what
 * the merchant was shown, what they decided, and whether that decision still
 * describes what would be published.
 *
 * Composes the pure logic in lib/preview-snapshot.ts (hashing + the material-change
 * resolver + the activation decision) with the Supabase tables from the S2
 * migration. The pure module holds every rule that must not silently drift; this
 * module only persists and reads.
 *
 * Runtime: Node only (service-role Supabase client). Never import from Edge.
 */
import 'server-only'
import { db } from '@/lib/supabase'
import {
  type PreviewSnapshot,
  hashSnapshot,
  canActivate,
  describeMaterialChanges,
} from '@/lib/preview-snapshot'
import {
  type MerchantPreview,
  getPreviewPresentation,
} from '@/lib/preview-access'
import {
  type ChecklistItem,
  buildChecklist,
  checklistComplete,
  nextAction,
} from '@/lib/preview-checklist'

/** Build the snapshot for a preview from its current live presentation. */
export async function currentSnapshot(preview: MerchantPreview): Promise<PreviewSnapshot | null> {
  const presentation = await getPreviewPresentation(preview)
  if (!presentation) return null
  return {
    shopName: presentation.shopName,
    shopSlug: presentation.shopSlug,
    products: presentation.products.map((p) => ({
      id: p.id,
      title: p.title,
      priceCents: p.priceCents,
      currency: p.currency,
      imageUrl: p.imageUrl,
    })),
  }
}

export interface ApprovalState {
  preview: MerchantPreview
  snapshot: PreviewSnapshot
  currentHash: string
  /** The hash the merchant approved, if any. Cleared when a material edit lands. */
  approvedHash: string | null
  /** True when an approval exists but no longer matches what would be published. */
  stale: boolean
  /** Plain-language es-MX reasons the approval went stale (empty when not stale). */
  staleReasons: string[]
}

/**
 * Read the full approval state for a preview: the live snapshot, the approved
 * hash, and whether the two still agree. This is the single read every consent
 * surface (merchant review page, promoter workspace, activation route) works from,
 * so they can never disagree about whether consent is current.
 */
export async function readApprovalState(preview: MerchantPreview): Promise<ApprovalState | null> {
  const snapshot = await currentSnapshot(preview)
  if (!snapshot) return null

  const { data: row } = await db
    .from('merchant_previews')
    .select('approved_snapshot_hash')
    .eq('id', preview.id)
    .maybeSingle()

  const approvedHash = (row?.approved_snapshot_hash as string | null) ?? null
  const currentHash = hashSnapshot(snapshot)
  const stale = approvedHash !== null && approvedHash !== currentHash

  // Explain staleness against the snapshot the merchant actually approved — the
  // hash alone proves a change happened but not what it was.
  let staleReasons: string[] = []
  if (stale) {
    const { data: decision } = await db
      .from('merchant_preview_decisions')
      .select('snapshot')
      .eq('preview_id', preview.id)
      .eq('decision', 'approved')
      .eq('snapshot_hash', approvedHash)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (decision?.snapshot) {
      staleReasons = describeMaterialChanges(decision.snapshot as PreviewSnapshot, snapshot)
    }
  }

  return { preview, snapshot, currentHash, approvedHash, stale, staleReasons }
}

/**
 * Record a merchant decision on the snapshot they are looking at RIGHT NOW.
 *
 * `expectedHash` is the hash the merchant's page was rendered from — if the
 * proposal changed between render and click, the decision is refused rather than
 * silently applied to a different proposal than the one reviewed. That check is
 * the whole point of versioned consent, so it is enforced here, server-side, not
 * in the UI.
 */
export async function recordDecision(input: {
  preview: MerchantPreview
  decision: 'approved' | 'changes_requested'
  expectedHash: string
  grantId?: string | null
  note?: string | null
  ipHash?: string | null
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const state = await readApprovalState(input.preview)
  if (!state) return { ok: false, reason: 'No se pudo leer la propuesta.' }

  if (state.currentHash !== input.expectedHash) {
    return {
      ok: false,
      reason: 'La propuesta cambió mientras la revisabas. Vuelve a cargarla para ver la versión actual.',
    }
  }

  const nextVersion = input.preview.currentVersion + 1

  const { error: decisionError } = await db.from('merchant_preview_decisions').insert({
    preview_id: input.preview.id,
    version: nextVersion,
    decision: input.decision,
    snapshot_hash: state.currentHash,
    snapshot: state.snapshot,
    grant_id: input.grantId ?? null,
    actor_note: input.note ?? null,
    actor_ip_hash: input.ipHash ?? null,
  })
  if (decisionError) return { ok: false, reason: 'No se pudo registrar tu decisión. Inténtalo de nuevo.' }

  // The anchor mirrors the decision so every reader sees one consistent state.
  // An approval records the hash it covers; changes-requested clears any prior
  // approval, because the merchant has explicitly withdrawn consent to publish.
  const { error: updateError } = await db
    .from('merchant_previews')
    .update(
      input.decision === 'approved'
        ? {
            status: 'approved',
            current_version: nextVersion,
            approved_snapshot_hash: state.currentHash,
            approved_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
        : {
            status: 'changes_requested',
            current_version: nextVersion,
            approved_snapshot_hash: null,
            approved_at: null,
            updated_at: new Date().toISOString(),
          },
    )
    .eq('id', input.preview.id)
  if (updateError) return { ok: false, reason: 'No se pudo guardar tu decisión. Inténtalo de nuevo.' }

  return { ok: true }
}

/**
 * Invalidate an approval when the live proposal no longer matches it. Idempotent
 * and safe to call on every promoter edit: a snapshot that still matches is left
 * completely alone (so a cosmetic save never disturbs consent).
 */
export async function invalidateIfMaterialChange(
  preview: MerchantPreview,
): Promise<{ invalidated: boolean; reasons: string[] }> {
  const state = await readApprovalState(preview)
  if (!state || !state.stale) return { invalidated: false, reasons: [] }

  await db
    .from('merchant_previews')
    .update({
      status: 'invalidated',
      approved_snapshot_hash: null,
      approved_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', preview.id)

  return { invalidated: true, reasons: state.staleReasons }
}

/**
 * Build the preview-readiness checklist (Sprint 3.1) for a preview whose approval
 * state has already been read. Reads the shop's non-commerce identity/contact facts
 * from the mirror and feeds them, plus the live snapshot, into the PURE
 * `buildChecklist`. Only booleans cross the boundary — the merchant's actual email
 * never leaves this function.
 *
 * A failed shop read is reported as "no contact / no location" rather than throwing:
 * that makes the checklist INCOMPLETE, which fails activation CLOSED — consistent
 * with the epic's posture that an unverifiable state never authorizes publication.
 */
export async function readChecklist(
  preview: MerchantPreview,
  state: ApprovalState,
): Promise<ChecklistItem[]> {
  const { data: shop } = await db
    .from('marketplace_shops')
    .select('metadata')
    .eq('id', preview.shopId)
    .maybeSingle()

  const metadata = (shop?.metadata ?? {}) as Record<string, unknown>
  const locationDetail = (metadata.location_detail ?? null) as Record<string, unknown> | null
  const merchantEmail = typeof metadata.merchant_email === 'string' ? metadata.merchant_email.trim() : ''

  return buildChecklist({
    shopName: state.snapshot.shopName,
    hasLocation: !!(locationDetail && (locationDetail.estado || locationDetail.municipio || locationDetail.cp)),
    hasMerchantContact: merchantEmail.length > 0,
    products: state.snapshot.products.map((p) => ({
      title: p.title,
      priceCents: p.priceCents,
      imageUrl: p.imageUrl,
    })),
    status: preview.status,
    currentApproval: state.approvedHash !== null && !state.stale,
    hasSteward: (preview.createdBy ?? '').length > 0,
  })
}

/**
 * The server-side activation gate. Composes the two rules that must BOTH hold, from
 * their pure resolvers, so the route, the UI and the specs read the same logic:
 *
 *  1. `canActivate` — there is a CURRENT approval (Sprint 2.3).
 *  2. `checklistComplete` — every required readiness item is done (Sprint 3.1:
 *     "incomplete required items block activation").
 *
 * Approval is checked first so the more fundamental consent failure is the one
 * reported; the checklist reason names the single next action.
 */
export async function checkActivation(
  preview: MerchantPreview,
): Promise<
  | { ok: true; snapshot: PreviewSnapshot; checklist: ChecklistItem[] }
  | { ok: false; reason: string; checklist?: ChecklistItem[] }
> {
  const state = await readApprovalState(preview)
  if (!state) return { ok: false, reason: 'No se pudo leer la propuesta.' }

  const decision = canActivate({
    status: preview.status,
    approvedSnapshotHash: state.approvedHash,
    currentSnapshotHash: state.currentHash,
    hasProducts: state.snapshot.products.length > 0,
  })

  const checklist = await readChecklist(preview, state)

  // An already-activated preview stays idempotently activatable regardless of the
  // checklist — re-running activation on a public shop must never start failing
  // because a later checklist item was added.
  if (preview.status === 'activated') {
    return decision.ok
      ? { ok: true, snapshot: state.snapshot, checklist }
      : { ok: false, reason: decision.reason, checklist }
  }

  if (!decision.ok) return { ok: false, reason: decision.reason, checklist }

  if (!checklistComplete(checklist)) {
    return {
      ok: false,
      reason: nextAction(checklist) ?? 'Faltan requisitos de la lista de verificación.',
      checklist,
    }
  }

  return { ok: true, snapshot: state.snapshot, checklist }
}

/** Mark a preview activated after the Medusa publish writes have all succeeded. */
export async function markActivated(previewId: string): Promise<boolean> {
  const { error } = await db
    .from('merchant_previews')
    .update({
      status: 'activated',
      activated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', previewId)
  return !error
}
