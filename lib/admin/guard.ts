import 'server-only'
import { after } from 'next/server'
import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { isAdminUser } from '@/lib/admin/identity'
import { db } from '@/lib/supabase'
import {
  auditActionLabel,
  auditTargetFromPath,
  isAuditedMethod,
  redactAuditPayload,
} from '@/lib/admin/audit'

/**
 * Server-side admin guards. **Clerk-only as of S2.3** — every admin page/route
 * is gated by Clerk admin identity; the legacy URL/`?secret=` acceptance for
 * humans has been retired. `ADMIN_SECRET` survives only on a few documented
 * machine paths that have no Clerk session (the `/api/admin/import` Bearer batch
 * route, and the PDF render path that headless Chromium loads) — those check the
 * secret themselves, not via these guards.
 *
 *   • `requireAdmin()` — for server **pages**. Resolves the Clerk user; if not
 *     an admin, `redirect('/')`.
 *   • `withAdmin(handler)` — for **API routes**. Passes on a Clerk admin; else
 *     `401`. Writes a best-effort `admin_audit_log` row on each successful
 *     mutation (S2.1).
 *   • `withSupplyAdmin(handler)` — **`/api/supply/*` only.** Clerk admin OR the
 *     shared `ADMIN_SECRET` (the documented headless importer path — see below).
 *
 * The identity decision lives in the pure `lib/admin/identity.ts`.
 */

/** Is the currently signed-in Clerk user a platform admin? */
export async function currentUserIsAdmin(): Promise<boolean> {
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

/**
 * Page guard. Call at the top of an admin server page. Redirects to `/` unless
 * the visitor is a Clerk admin.
 */
export async function requireAdmin(): Promise<void> {
  if (await currentUserIsAdmin()) return
  redirect('/')
}

type RouteHandler<R extends Request, C> = (req: R, context: C) => Response | Promise<Response>

/**
 * API-route wrapper. Wrap a route handler so it only runs for a Clerk admin;
 * otherwise it returns `401` before the handler is invoked. Generic over the
 * request type so a handler may take a `NextRequest` (for `req.nextUrl`) or no
 * argument at all. Writes a best-effort `admin_audit_log` row on each successful
 * mutation (S2.1).
 */
export function withAdmin<R extends Request = Request, C = unknown>(
  handler: RouteHandler<R, C>,
): (req: R, context: C) => Promise<Response> {
  return async (req: R, context: C) => {
    if (!(await currentUserIsAdmin())) {
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
      // `after()` registers the write with the platform's `waitUntil`, so the
      // audit row is guaranteed to land even though it runs post-response — a
      // bare fire-and-forget would be killed when the serverless fn suspends.
      after(() => recordAdminAudit(req, bodyClone))
    }
    return res
  }
}

/**
 * Shared-secret check for the documented headless **machine** paths. Reads the
 * secret from the `x-admin-secret` header or the `?secret=` query string and
 * compares it to `ADMIN_SECRET`. Returns `false` when `ADMIN_SECRET` is unset or
 * empty — no configured secret means no secret-based access (never fail-open).
 */
function hasValidAdminSecret(req: Request): boolean {
  const secret = process.env.ADMIN_SECRET
  if (!secret) return false
  if (req.headers.get('x-admin-secret') === secret) return true
  try {
    if (new URL(req.url).searchParams.get('secret') === secret) return true
  } catch {
    /* malformed URL — fall through to deny */
  }
  return false
}

/**
 * API-route wrapper for **`/api/supply/*` only**. The supply acquisition
 * pipeline is a documented *machine* surface: a headless importer with no Clerk
 * session drives it per `SUPPLY_IMPORT_SCHEMA.md`, whose contract is *"All supply
 * endpoints require `x-admin-secret` or `?secret=`"* (and `/api/supply/upload`'s
 * *"No Clerk login needed — same secret as the rest"*).
 *
 * S2.3 (#109) migrated every admin route onto Clerk-only `withAdmin`, which
 * **unintentionally also revoked that documented headless path** — the migration
 * preserved machine access only on `/api/admin/import` + the PDF render route,
 * overlooking that the live importer targets `/api/supply/*`. This wrapper
 * restores it: a request is authorised by EITHER a Clerk admin session (the
 * `/admin/supply` review UI, same-origin cookie) OR the shared `ADMIN_SECRET`
 * (the importer). Successful Clerk mutations are still audited; the machine path
 * has no Clerk actor (null), exactly like the pre-S2.3 secret arm.
 *
 * Deliberately narrow — do NOT reuse for `/api/admin/*`; those stay Clerk-only.
 */
export function withSupplyAdmin<R extends Request = Request, C = unknown>(
  handler: RouteHandler<R, C>,
): (req: R, context: C) => Promise<Response> {
  return async (req: R, context: C) => {
    const clerkAdmin = await currentUserIsAdmin()
    if (!clerkAdmin && !hasValidAdminSecret(req)) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const audited = isAuditedMethod(req.method)
    const bodyClone = audited ? req.clone() : null
    const res = await handler(req, context)
    if (audited && res.status < 400) {
      after(() => recordAdminAudit(req, bodyClone))
    }
    return res
  }
}
