/**
 * Admin audit summary — pure, next-free, unit-testable.
 *
 * The server guard (`lib/admin/guard.ts withAdmin`) calls these to build an
 * `admin_audit_log` row on every successful admin mutation; the api spec
 * (`e2e/admin-audit.spec.ts`) exercises the labelling + redaction directly.
 * Keep this module free of `next`, Clerk, and DB imports so the Playwright
 * `api` runner can load it.
 *
 * The redaction rule is the load-bearing part: a payload summary must NEVER
 * carry a secret. We redact by KEY (anything that looks like a credential) and
 * cap value/object size — the same "redact by marker, never echo the value"
 * discipline used elsewhere.
 */

/** HTTP methods that mutate state — the ones we audit. */
export const AUDITED_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'] as const
export type AuditedMethod = (typeof AUDITED_METHODS)[number]

/** True when this method mutates state and should be audited. */
export function isAuditedMethod(method: string): boolean {
  return (AUDITED_METHODS as readonly string[]).includes(method.toUpperCase())
}

/** A stable, human-readable action label, e.g. `"PATCH /api/admin/print/social/abc"`. */
export function auditActionLabel(method: string, pathname: string): string {
  return `${method.toUpperCase()} ${pathname}`
}

/**
 * Best-effort target id from a route path: the last non-empty segment, when it
 * looks like an id (not a known collection/verb word). Returns null otherwise —
 * the row's `target` is informational, never load-bearing.
 */
export function auditTargetFromPath(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return null
  const last = segments[segments.length - 1]
  // Collection/verb-ish tails carry no per-row target.
  const collectionish = new Set([
    'admin', 'supply', 'config', 'batches', 'items', 'import', 'status',
    'schema', 'upload', 'coupons', 'social', 'providers', 'editions',
    'submissions', 'catalog', 'runs', 'scrape', 'referrals', 'audit',
  ])
  if (collectionish.has(last.toLowerCase())) return null
  return last
}

/** Keys whose VALUES must never be stored (credentials). */
const REDACT_KEY = /secret|password|passwd|token|authorization|api[_-]?key|bearer/i

const MAX_STRING = 200
const MAX_KEYS = 40

/**
 * Build a redacted, size-capped summary of a request body for `payload_summary`.
 * - Credential-looking keys → `'[redacted]'` (by key name, regardless of value).
 * - Long strings truncated to `MAX_STRING`.
 * - Objects capped at `MAX_KEYS` top-level keys.
 * - Non-object bodies (arrays, primitives) summarised by shape, not echoed whole.
 * Never throws.
 */
export function redactAuditPayload(body: unknown): Record<string, unknown> {
  if (body == null) return {}
  if (Array.isArray(body)) return { _type: 'array', length: body.length }
  if (typeof body !== 'object') return { _type: typeof body }

  const out: Record<string, unknown> = {}
  let count = 0
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (count >= MAX_KEYS) {
      out._truncated = true
      break
    }
    count++
    if (REDACT_KEY.test(key)) {
      out[key] = '[redacted]'
      continue
    }
    out[key] = redactValue(value)
  }
  return out
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value
  }
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return { _type: 'array', length: value.length }
  // Nested objects: summarise by key count, don't deep-walk (keeps the row small).
  return { _type: 'object', keys: Object.keys(value as object).length }
}
