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
export type SlaPolicySource = 'stored' | 'code_default' | 'unreadable'

export interface LoadedSlaPolicy {
  policy: SlaPolicy
  source: SlaPolicySource
  updatedBy: string | null
  updatedAt: string | null
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
    return { policy: DEFAULT_SLA_POLICY, source: 'unreadable', updatedBy: null, updatedAt: null }
  }

  if (!data) {
    // The expected steady state: the migration deliberately seeds nothing, so
    // absence means "the code default IS the policy" (README D3).
    return { policy: DEFAULT_SLA_POLICY, source: 'code_default', updatedBy: null, updatedAt: null }
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
    return { policy: DEFAULT_SLA_POLICY, source: 'unreadable', updatedBy: row.updated_by, updatedAt: row.updated_at }
  }

  return { policy: parsed, source: 'stored', updatedBy: row.updated_by, updatedAt: row.updated_at }
}

export type WriteSlaPolicyResult = { ok: true; policy: SlaPolicy } | { ok: false; error: string }

/**
 * Upsert the single policy row, bumping `version` on every write (the caller
 * never chooses a version — a client-supplied one could go backwards and make
 * two different documents claim the same version).
 *
 * The version to write is derived from the CURRENT load: `stored` ⇒ its version
 * + 1; anything else ⇒ `DEFAULT_SLA_POLICY.version + 1`, so the first stored
 * policy is always strictly newer than the code default it replaces. An
 * `unreadable` current row still gets bumped past whatever the code default
 * claims rather than reusing a version number that may already be in flight.
 */
export async function writeSlaPolicy(next: SlaPolicy, updatedBy: string): Promise<WriteSlaPolicyResult> {
  const current = await loadSlaPolicy()
  const baseVersion = current.source === 'stored' ? current.policy.version : DEFAULT_SLA_POLICY.version
  const versioned: SlaPolicy = { ...next, version: baseVersion + 1 }

  const { error } = await db.from(TABLE).upsert(
    {
      id: SINGLETON_ID,
      version: versioned.version,
      policy: serializeSlaPolicy(versioned),
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  )

  if (error) {
    console.error('[portfolio/policy] merchant_sla_policy write failed:', error.message)
    return { ok: false, error: 'No se pudo guardar la política de SLA.' }
  }

  return { ok: true, policy: versioned }
}
