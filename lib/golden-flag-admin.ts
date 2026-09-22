import 'server-only'

/**
 * `GOLDEN_BEANS_FLAG_ADMIN_KEY` — now ONLY the shared secret for the signed server-to-server
 * resilience protocols (`/api/internal/resilience/*`).
 *
 * flag-provider-mandate S2.1 deleted the flag READ/WRITE client that used to live here
 * (`getGoldenAdminSnapshot` / `setGoldenAdminFlag`). It pointed at the retired legacy Golden
 * catalog, so `/admin/flags` was a second window onto a project that no longer decides, and its
 * toggle made the page a second writer. Flags are changed in Golden's console, full stop; the admin
 * page reads the runtime's own snapshot (`readGoldenFlagSnapshot`).
 */
export class GoldenFlagAdminUnavailable extends Error {}

/** Shared only by signed server-to-server control-plane protocols; never return this to a client. */
export function getGoldenFlagAdminCredential(): string {
  const credential = process.env.GOLDEN_BEANS_FLAG_ADMIN_KEY
  if (!credential || credential.length < 16) {
    throw new GoldenFlagAdminUnavailable('Flag admin is not configured')
  }
  return credential
}
