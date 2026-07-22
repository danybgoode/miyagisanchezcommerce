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
import { isEnabled } from '@/lib/flags'
import {
  type PreviewSnapshot,
  hashSnapshot,
  canActivate,
  describeMaterialChanges,
  isResumableActivation,
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
  /**
   * The exact proposal the merchant approved, as it was shown to them. This — not
   * the live draft list — is what activation publishes, because activation CONSUMES
   * the draft list (see `isResumableActivation`).
   */
  approvedSnapshot: PreviewSnapshot | null
  /** True when an approval exists but no longer matches what would be published. */
  stale: boolean
  /** Plain-language es-MX reasons the approval went stale (empty when not stale). */
  staleReasons: string[]
  /** S4: how the current approval was merchant-verified (`email`/`whatsapp`), or
   *  null for an unverified (legacy / flag-off) approval. Used by the activation
   *  gate to refuse an unverified approval when verified-approval is enforced. */
  approvedVerifiedVia: 'email' | 'whatsapp' | null
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

  // Load the proposal the merchant actually approved whenever one exists — it is
  // both the explanation of any staleness AND the authoritative publish set.
  let approvedSnapshot: PreviewSnapshot | null = null
  let approvedVerifiedVia: 'email' | 'whatsapp' | null = null
  if (approvedHash !== null) {
    const { data: decision } = await db
      .from('merchant_preview_decisions')
      .select('snapshot, verified_via')
      .eq('preview_id', preview.id)
      .eq('decision', 'approved')
      .eq('snapshot_hash', approvedHash)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (decision?.snapshot) approvedSnapshot = decision.snapshot as PreviewSnapshot
    const via = (decision as { verified_via?: string | null } | null)?.verified_via
    approvedVerifiedVia = via === 'email' || via === 'whatsapp' ? via : null
  }

  // A hash difference is only STALE if it reflects a real promoter edit. A live
  // snapshot that is the approved one minus already-published products is a
  // resumable partial activation, not a change of proposal — treating it as stale
  // would strand the preview permanently (see `isResumableActivation`).
  const hashDiffers = approvedHash !== null && approvedHash !== currentHash
  const resumable =
    hashDiffers && approvedSnapshot !== null && isResumableActivation(approvedSnapshot, snapshot)
  const stale = hashDiffers && !resumable

  // Explain staleness against the snapshot the merchant approved — the hash alone
  // proves a change happened but not what it was.
  const staleReasons =
    stale && approvedSnapshot ? describeMaterialChanges(approvedSnapshot, snapshot) : []

  return { preview, snapshot, currentHash, approvedHash, approvedSnapshot, stale, staleReasons, approvedVerifiedVia }
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
  /** S4: how an approval was merchant-verified (email/whatsapp) + the hashed
   *  contact it was verified against. NULL for a changes-requested or a flag-off
   *  approval — honestly labeled, never back-filled. */
  verifiedVia?: 'email' | 'whatsapp' | null
  verifiedContactHash?: string | null
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
    verified_via: input.decision === 'approved' ? (input.verifiedVia ?? null) : null,
    verified_contact_hash: input.decision === 'approved' ? (input.verifiedContactHash ?? null) : null,
  })
  if (decisionError) return { ok: false, reason: 'No se pudo registrar tu decisión. Inténtalo de nuevo.' }

  // The anchor mirrors the decision so every reader sees one consistent state.
  // An approval records the hash it covers; changes-requested clears any prior
  // approval, because the merchant has explicitly withdrawn consent to publish.
  //
  // COMPARE-AND-SET on `current_version`. Two decisions racing (a double-tap, or an
  // approve immediately followed by a request-changes on a slow connection) both
  // read the same `currentVersion` and both write `nextVersion`; without this
  // predicate the LAST write wins, which can leave the anchor `approved` with a
  // live hash even though the merchant's final action was to withdraw. The
  // append-only log would hold the truth while the field activation reads does not.
  // The loser gets a clear retry message rather than a silently discarded decision.
  const { data: updated, error: updateError } = await db
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
    .eq('current_version', input.preview.currentVersion)
    .select('id')
  if (updateError) return { ok: false, reason: 'No se pudo guardar tu decisión. Inténtalo de nuevo.' }
  if (!updated || updated.length === 0) {
    return {
      ok: false,
      reason: 'Se registró otra decisión al mismo tiempo. Vuelve a cargar la página para ver el estado actual.',
    }
  }

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

  // Evaluate the checklist against WHAT WILL BE PUBLISHED — the approved snapshot
  // once one exists, otherwise the live proposal. Using the live draft list after a
  // partial activation would make the product/price/photo items fail (or an emptied
  // draft list fail everything) on a preview that is mid-publish.
  const effective = effectiveSnapshot(state)

  return buildChecklist({
    shopName: effective.shopName,
    hasLocation: !!(locationDetail && (locationDetail.estado || locationDetail.municipio || locationDetail.cp)),
    hasMerchantContact: merchantEmail.length > 0,
    products: effective.products.map((p) => ({
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
 * The proposal that activation would actually publish: the approved snapshot when
 * the merchant has approved one, otherwise the live proposal. Activation consumes
 * the live draft list, so only the approved snapshot stays complete across a
 * partial/retried activation.
 */
function effectiveSnapshot(state: ApprovalState): PreviewSnapshot {
  return state.approvedSnapshot ?? state.snapshot
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
  | { ok: true; snapshot: PreviewSnapshot; checklist: ChecklistItem[]; approvedHash: string | null }
  | { ok: false; reason: string; checklist?: ChecklistItem[] }
> {
  const state = await readApprovalState(preview)
  if (!state) return { ok: false, reason: 'No se pudo leer la propuesta.' }

  // The set activation would publish. After a partial activation the live draft
  // list has shrunk (or emptied), so `hasProducts` and the published set must both
  // come from the approved snapshot — otherwise a half-finished activation can
  // never be resumed.
  const publishSet = effectiveSnapshot(state)

  const decision = canActivate({
    status: preview.status,
    approvedSnapshotHash: state.approvedHash,
    // `stale` already accounts for a resumable partial activation, so feed the
    // comparison a matching hash when the difference is only "we published some".
    currentSnapshotHash: state.stale ? state.currentHash : (state.approvedHash ?? state.currentHash),
    hasProducts: publishSet.products.length > 0,
  })

  const checklist = await readChecklist(preview, state)

  // An already-activated preview stays idempotently activatable regardless of the
  // checklist — re-running activation on a public shop must never start failing
  // because a later checklist item was added.
  if (preview.status === 'activated') {
    return decision.ok
      ? { ok: true, snapshot: publishSet, checklist, approvedHash: state.approvedHash }
      : { ok: false, reason: decision.reason, checklist }
  }

  if (!decision.ok) return { ok: false, reason: decision.reason, checklist }

  // S4: when verified approval is enforced, an approval with no merchant-verified
  // provenance does NOT count as a current approval — activation is refused until
  // the merchant approves with a code. Checked here (not in the pure `canActivate`)
  // because it depends on the flag + the DB-read provenance. Only for a NON-activated
  // preview: an already-activated shop stays idempotently activatable (handled above)
  // and legacy approvals recorded before this shipped stay honestly unverified.
  if (await isEnabled('promoter.preview_verified_approval_enabled')) {
    if (state.approvedVerifiedVia === null) {
      return {
        ok: false,
        reason: 'Falta la aprobación verificada del comerciante. Pídele que confirme con el código enviado a su contacto.',
        checklist,
      }
    }
  }

  if (!checklistComplete(checklist)) {
    return {
      ok: false,
      reason: nextAction(checklist) ?? 'Faltan requisitos de la lista de verificación.',
      checklist,
    }
  }

  return { ok: true, snapshot: publishSet, checklist, approvedHash: state.approvedHash }
}

/**
 * Mark a preview activated after the Medusa publish writes have all succeeded.
 *
 * COMPARE-AND-SET on the approval this activation was authorized by. Activation is
 * not atomic — `checkActivation` runs, then N sequential Medusa publishes, then
 * this. In that window the merchant can open their link and click "Solicitar
 * cambios", which sets `status='changes_requested'` and clears
 * `approved_snapshot_hash`. An unconditional update would overwrite that and take
 * the shop public seconds after the merchant explicitly withdrew consent — with the
 * consent log and the anchor then disagreeing about what happened.
 *
 * Predicating on the exact approved hash also makes a re-approval at a DIFFERENT
 * version fail closed rather than being silently activated under the old decision.
 *
 * Returns false when the row no longer matches, which the caller surfaces as a
 * refusal (the publishes already landed, but the shop shell stays private, so
 * nothing is public that the merchant did not approve).
 */
export async function markActivated(previewId: string, approvedHash: string): Promise<boolean> {
  const { data, error } = await db
    .from('merchant_previews')
    .update({
      status: 'activated',
      activated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', previewId)
    .eq('status', 'approved')
    .eq('approved_snapshot_hash', approvedHash)
    .select('id')
  if (error || !data) return false
  return data.length > 0
}
