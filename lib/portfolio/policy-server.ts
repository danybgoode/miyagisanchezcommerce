/**
 * lib/portfolio/policy-server.ts
 *
 * Merchant Partner lifecycle · Sprint 1, Story 1.1 — the IMPURE half of the SLA
 * contract (README D3). Reads and writes the single `merchant_sla_policy` row;
 * every DECISION over the policy document lives in the zero-import
 * `lib/portfolio/sla.ts` sibling, which this module never duplicates. Same
 * pure/impure split as `lib/scorecard/{resolver,loader}.ts`.
 *
 * FAIL CLOSED TO THE CODE DEFAULT, LOUDLY. `loadSlaPolicy()` returns
 * `DEFAULT_SLA_POLICY` when the row is ABSENT (the expected steady state — the
 * migration seeds nothing) and ALSO when the read FAILS or the stored document
 * is malformed. Those two cases are distinguished in the RESULT (`source`), not
 * collapsed: an unreadable policy is logged at error level and reported to the
 * caller, because "we could not read the policy" and "there is no policy, use
 * the default" are different operational facts even though they resolve to the
 * same windows. What never happens is a silent half-policy or a `null` the
 * caller might read as "no deadline" (LEARNINGS: a read error must never look
 * like empty data — that exact bug shipped twice in this family).
 *
 * Runtime: Node only (Supabase service-role client).
 */
import 'server-only'
import { db } from '@/lib/supabase'
import {
  DEFAULT_SLA_POLICY,
  parseSlaPolicy,
  serializeSlaPolicy,
  type SlaPolicy,
} from '@/lib/portfolio/sla'

const TABLE = 'merchant_sla_policy'
/** The single-row id the migration's `CHECK (id = 1)` guarantees. */
const SINGLETON_ID = 1

/** Where the policy in hand came from — surfaced so the admin GET and any
 *  future banner can tell "nobody has configured one yet" apart from "we
 *  couldn't read the one that exists". */
/**
 * `unreadable` was ONE value and had to become TWO (fresh-reviewer finding 1,
 * PR 308). Both meant "fall back to the code default", which is right for the
 * READ path — but the WRITE path has to bump a version, and the two cases carry
 * completely different knowledge:
 *
 *   - `read_failed`  — the query itself errored. We know NOTHING about the row,
 *                      including what version it holds. A write cannot safely
 *                      pick a next version, so it must REFUSE.
 *   - `malformed`    — we read the row fine; its document failed validation (or
 *                      its `version` column disagrees with the document's own).
 *                      We DO know the column version, so a write can bump past
 *                      it and repair the row in the same operation.
 *
 * Collapsing them is what let a transient read error rewind `version` from 7 to
 * 2 — see `writeSlaPolicy`.
 */
export type SlaPolicySource = 'stored' | 'code_default' | 'read_failed' | 'malformed'

export interface LoadedSlaPolicy {
  policy: SlaPolicy
  source: SlaPolicySource
  updatedBy: string | null
  updatedAt: string | null
  /** The raw `version` COLUMN as stored, independent of whether the document
   *  parsed. `null` when there is no row or the read failed outright. Carried
   *  out solely so `writeSlaPolicy` can guarantee monotonicity even when the
   *  document is unusable — without it, a malformed row's version is invisible
   *  to the only code that must never go backwards. */
  rawVersion: number | null
}

/**
 * Read the active policy. NEVER throws and never returns a partial policy —
 * every failure path resolves to `DEFAULT_SLA_POLICY` with a `source` that says
 * why.
 */
export async function loadSlaPolicy(): Promise<LoadedSlaPolicy> {
  const { data, error } = await db
    .from(TABLE)
    .select('version, policy, updated_by, updated_at')
    .eq('id', SINGLETON_ID)
    .maybeSingle()

  if (error) {
    console.error('[portfolio/policy] merchant_sla_policy read failed — falling back to the code default:', error.message)
    return { policy: DEFAULT_SLA_POLICY, source: 'read_failed', updatedBy: null, updatedAt: null, rawVersion: null }
  }

  if (!data) {
    // The expected steady state: the migration deliberately seeds nothing, so
    // absence means "the code default IS the policy" (README D3).
    return { policy: DEFAULT_SLA_POLICY, source: 'code_default', updatedBy: null, updatedAt: null, rawVersion: null }
  }

  const row = data as { version: number | null; policy: unknown; updated_by: string | null; updated_at: string | null }
  // The stored `version` column and the document's own `version` must agree —
  // the column is what SQL can query, the document is what the parser validates.
  // A disagreement means something wrote the row without going through the PUT
  // below; treat the document as malformed rather than picking a winner.
  const parsed = parseSlaPolicy(row.policy)
  const documentVersionMatches = row.version !== null && parsed.version === row.version
  const isDefault = parsed === DEFAULT_SLA_POLICY

  if (isDefault || !documentVersionMatches) {
    console.error(
      `[portfolio/policy] merchant_sla_policy row is unusable (${isDefault ? 'malformed document' : `version column ${row.version} ≠ document ${parsed.version}`}) — falling back to the code default`,
    )
    return {
      policy: DEFAULT_SLA_POLICY,
      source: 'malformed',
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
      rawVersion: row.version,
    }
  }

  return { policy: parsed, source: 'stored', updatedBy: row.updated_by, updatedAt: row.updated_at, rawVersion: row.version }
}

export type WriteSlaPolicyResult =
  | { ok: true; policy: SlaPolicy }
  | { ok: false; error: string; conflict?: true }

/**
 * Upsert the single policy row, bumping `version` on every write (the caller
 * never chooses a version — a client-supplied one could go backwards and make
 * two different documents claim the same version).
 *
 * `version` MUST be monotonic. Its whole purpose is that
 * `merchant_relationships.sla_policy_version` and every rendered portfolio row
 * can name the policy they were computed under; two materially different
 * documents claiming the same version makes every one of those stamps
 * non-comparable, permanently and silently.
 *
 * FIX (fresh-reviewer finding 1, PR 308). The original rule was `stored ⇒
 * its version + 1, anything else ⇒ DEFAULT_SLA_POLICY.version + 1` — and since
 * the default's version is 1, ANY non-`stored` load wrote version **2**. A
 * single transient Supabase error at PUT time was therefore enough to rewind a
 * row sitting at version 7 back to 2. That is also the only place in this
 * sprint where an unreadable read became a VALUE instead of a refusal: the
 * route header correctly argues that `parseSlaPolicy`'s fail-closed-to-default
 * is "exactly wrong on the write path" for the DOCUMENT, and then did precisely
 * that for the VERSION.
 *
 * The two failure modes now diverge, because they carry different knowledge
 * (see `SlaPolicySource`):
 *
 *   - `read_failed` ⇒ **REFUSE** (409). We could not read the row at all, so
 *     every candidate version is a guess, and guessing is what caused the bug.
 *     A retry once the database answers is the correct recovery — deliberately
 *     NOT a best-effort write.
 *   - `malformed` ⇒ bump past `max(rawVersion, document, default)` and REPAIR
 *     the row in the same write. We read the column, so monotonicity is
 *     provable; refusing here would instead dead-end the only surface that can
 *     fix a hand-edited row (there is no admin UI, D3).
 *
 * SECOND FIX — COMPARE-AND-SWAP (cross-agent review, PR 308). Monotonic-forward
 * was necessary but NOT sufficient: the version was still computed from a value
 * read in a SEPARATE round trip, so two concurrent `PUT`s both read version N and
 * both wrote N+1. `.upsert()` made the second one a silent overwrite: last write
 * wins, the loser's document is gone with no error, and TWO materially different
 * policies have both claimed N+1 — destroying exactly the version-to-policy
 * identity the first fix existed to protect. A lost update is worse than a
 * refused one, because nothing anywhere records that it happened.
 *
 * So the write is now CONDITIONAL on the version we actually read:
 *   - a row exists ⇒ `UPDATE … WHERE id = 1 AND version = <the one we read>`.
 *     Zero rows affected means somebody else moved it first ⇒ 409, re-read and
 *     retry. The predicate IS the concurrency control; no advisory lock, no
 *     transaction, no `SELECT … FOR UPDATE` round trip.
 *   - no row exists ⇒ plain `INSERT`. A `23505` on the `id = 1` primary key means
 *     a concurrent writer created it between our read and our insert ⇒ also 409.
 * `.upsert()` cannot express either check, which is precisely why it hid the race.
 */
export async function writeSlaPolicy(next: SlaPolicy, updatedBy: string): Promise<WriteSlaPolicyResult> {
  const current = await loadSlaPolicy()

  if (current.source === 'read_failed') {
    return {
      ok: false,
      conflict: true,
      error:
        'No se pudo leer la política actual, así que no se puede calcular la siguiente versión sin riesgo de retrocederla. Vuelve a intentar en un momento.',
    }
  }

  // Never below any version we have actually observed. `rawVersion` covers the
  // malformed row whose document didn't parse; `current.policy.version` covers
  // the stored one; the code default is the floor for a fresh table.
  const baseVersion = Math.max(current.rawVersion ?? 0, current.policy.version, DEFAULT_SLA_POLICY.version)
  const versioned: SlaPolicy = { ...next, version: baseVersion + 1 }

  const row = {
    version: versioned.version,
    policy: serializeSlaPolicy(versioned),
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  }

  const CONFLICT: WriteSlaPolicyResult = {
    ok: false,
    conflict: true,
    error:
      'Otro administrador guardó la política mientras editabas. Vuelve a cargarla para ver la versión actual y aplica tu cambio encima.',
  }

  // NO ROW YET ⇒ plain INSERT. `23505` on the `id = 1` primary key means a
  // concurrent writer inserted between our read and ours — a conflict, never an
  // overwrite of a policy we never saw.
  if (current.rawVersion === null) {
    const { error } = await db.from(TABLE).insert({ id: SINGLETON_ID, ...row })
    if (error) {
      if (error.code === '23505') return CONFLICT
      console.error('[portfolio/policy] merchant_sla_policy insert failed:', error.message)
      return { ok: false, error: 'No se pudo guardar la política de SLA.' }
    }
    return { ok: true, policy: versioned }
  }

  // A ROW EXISTS ⇒ CAS on the version we read. `.select('id')` is what makes the
  // affected-row count observable: supabase-js reports no error for an UPDATE that
  // matched nothing, so without the select-back a lost update looks identical to a
  // successful one — which is the whole bug.
  const { data, error } = await db
    .from(TABLE)
    .update(row)
    .eq('id', SINGLETON_ID)
    .eq('version', current.rawVersion)
    .select('id')

  if (error) {
    console.error('[portfolio/policy] merchant_sla_policy update failed:', error.message)
    return { ok: false, error: 'No se pudo guardar la política de SLA.' }
  }
  if (!data || data.length === 0) return CONFLICT

  return { ok: true, policy: versioned }
}
