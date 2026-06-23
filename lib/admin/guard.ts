import 'server-only'
import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { checkAdminSecret } from '@/lib/print-server'
import { isAdminUser } from '@/lib/admin/identity'
import { db } from '@/lib/supabase'
import {
  auditActionLabel,
  auditTargetFromPath,
  isAuditedMethod,
  redactAuditPayload,
} from '@/lib/admin/audit'

/**
 * Server-side admin guards. **Dual-accept this sprint** — a request passes as a
 * Clerk admin (target) OR with the legacy `ADMIN_SECRET` (so existing
 * routes/scripts keep working untouched while the shell consolidates). The full
 * migration that *removes* secret acceptance per-section is S2.3.
 *
 *   • `requireAdmin({ secret? })` — for server **pages**. Resolves the Clerk
 *     user; if not an admin, falls back to a matching `?secret=`; else
 *     `redirect('/')`.
 *   • `withAdmin(handler)` — for **API routes**. Passes on `checkAdminSecret`
 *     (header/`?secret=`) OR a Clerk admin; else `401`.
 *
 * The identity decision lives in the pure `lib/admin/identity.ts`; the secret
 * check is reused from `lib/print-server.ts` unchanged.
 */

/** Is the currently signed-in Clerk user a platform admin? */
async function currentUserIsAdmin(): Promise<boolean> {
  const user = await currentUser().catch(() => null)
  if (!user) return false
  return isAdminUser({
    email: user.primaryEmailAddress?.emailAddress,
    role: user.publicMetadata?.role,
  })
}

/**
 * The acting admin's Clerk identity for the audit trail. Returns nulls when the
 * request authed via the legacy secret (machine path) rather than a Clerk
 * session — once S2.3 removes the secret arm, an actor is always present.
 */
async function currentAdminActor(): Promise<{ userId: string | null; email: string | null }> {
  const user = await currentUser().catch(() => null)
  return {
    userId: user?.id ?? null,
    email: user?.primaryEmailAddress?.emailAddress ?? null,
  }
}

/**
 * Best-effort audit write for a successful admin mutation. NEVER throws and
 * never blocks the response — a failed audit must not break a working mutation
 * (but we log it so a silently-dying write surfaces). `bodyClone` is a clone
 * taken before the handler consumed the request stream.
 */
async function recordAdminAudit(req: Request, bodyClone: Request | null): Promise<void> {
  try {
    const url = new URL(req.url)
    const body = bodyClone ? await bodyClone.json().catch(() => null) : null
    const actor = await currentAdminActor()
    const { error } = await db.from('admin_audit_log').insert({
      actor_user_id: actor.userId,
      actor_email: actor.email,
      action: auditActionLabel(req.method, url.pathname),
      target: auditTargetFromPath(url.pathname),
      payload_summary: redactAuditPayload(body),
    })
    if (error) console.error('admin_audit_log insert error:', error.message)
  } catch (e) {
    console.error('admin_audit_log write failed:', e)
  }
}

/** True when a provided secret string matches `ADMIN_SECRET` (non-empty). */
function secretMatches(secret?: string | null): boolean {
  const expected = process.env.ADMIN_SECRET
  return Boolean(expected) && secret === expected
}

/**
 * Page guard. Call at the top of an admin server page. Redirects to `/` unless
 * the visitor is a Clerk admin or carries a valid `?secret=` (dual-accept).
 */
export async function requireAdmin(opts?: { secret?: string }): Promise<void> {
  if (await currentUserIsAdmin()) return
  if (secretMatches(opts?.secret)) return
  redirect('/')
}

type RouteHandler<C> = (req: Request, context: C) => Response | Promise<Response>

/**
 * API-route wrapper. Wrap a route handler so it only runs for an admin
 * (dual-accept: `ADMIN_SECRET` header/query OR a Clerk admin); otherwise it
 * returns `401` before the handler is invoked.
 */
export function withAdmin<C>(handler: RouteHandler<C>): RouteHandler<C> {
  return async (req: Request, context: C) => {
    if (!(checkAdminSecret(req) || (await currentUserIsAdmin()))) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    // Clone the request *before* the handler consumes its body, so a mutation
    // can be summarised for the audit row after it succeeds.
    const audited = isAuditedMethod(req.method)
    const bodyClone = audited ? req.clone() : null
    const res = await handler(req, context)
    if (audited && res.status < 400) {
      void recordAdminAudit(req, bodyClone)
    }
    return res
  }
}
