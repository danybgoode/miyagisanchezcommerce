import 'server-only'
import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { checkAdminSecret } from '@/lib/print-server'
import { isAdminUser } from '@/lib/admin/identity'

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
    if (checkAdminSecret(req) || (await currentUserIsAdmin())) {
      return handler(req, context)
    }
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
