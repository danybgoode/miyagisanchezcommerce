/**
 * lib/ssrf-guard.ts
 *
 * Pure, dependency-free SSRF-hardening helpers for any server-side fetch of a
 * user-supplied domain (epic 03 · platform-migrations, Sprint 1 — the Shopify
 * connector is the first caller, `lib/shopify-mcp-client.ts`).
 *
 * Kept `server-only`-free and network-free on purpose (unlike its caller)
 * so the Playwright `api` runner can unit-test the classifiers directly —
 * same reason `lib/flags-cache.ts` / `lib/agent-auth.ts`'s pure halves stay
 * next-free (see LEARNINGS → "a unit-tested pure helper can't live in a
 * module that imports next/cache" — `server-only` has the identical bundler-
 * condition trap: importing it outside Next's build throws immediately).
 *
 * `isPublicDomainShape` is only a friendly early-reject (bad shape, bare IP,
 * localhost) — it does NOT close a DNS-rebinding gap on its own. The real
 * boundary resolves DNS and classifies every resolved address with
 * `isPrivateIpv4`/`isPrivateIpv6` before the real request goes out (see
 * `assertPublicHost` in `lib/shopify-mcp-client.ts`).
 */

/** A hostname-shape check — NOT the security boundary on its own. */
export function isPublicDomainShape(input: string): boolean {
  const host = input.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase()
  if (!host || host.length > 253) return false
  if (host === 'localhost' || host.endsWith('.local')) return false
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return false // bare IPv4 literal
  if (host.includes(':')) return false // no IPv6 literals / ports
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)
}

/** Is a resolved IPv4 address private/reserved/loopback/link-local? Malformed input fails closed (true). */
export function isPrivateIpv4(addr: string): boolean {
  const parts = addr.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = parts
  if (a === 0) return true // "this" network
  if (a === 10) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local (cloud metadata endpoints live here)
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 0 && parts[2] === 0) return true // IETF protocol assignments
  if (a === 192 && b === 0 && parts[2] === 2) return true // TEST-NET-1
  if (a === 192 && b === 168) return true
  if (a === 198 && (b === 18 || b === 19)) return true // benchmark
  if (a === 198 && b === 51 && parts[2] === 100) return true // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true // TEST-NET-3
  if (a >= 224) return true // multicast + reserved (224–255)
  return false
}

/** Is a resolved IPv6 address private/reserved/loopback/link-local? Unwraps an IPv4-mapped address. */
export function isPrivateIpv6(addr: string): boolean {
  const a = addr.toLowerCase()
  if (a === '::1' || a === '::') return true // loopback / unspecified
  if (a.startsWith('fc') || a.startsWith('fd')) return true // unique local (fc00::/7)
  if (a.startsWith('fe8') || a.startsWith('fe9') || a.startsWith('fea') || a.startsWith('feb')) return true // link-local
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(a)
  if (mapped) return isPrivateIpv4(mapped[1])
  return false
}
