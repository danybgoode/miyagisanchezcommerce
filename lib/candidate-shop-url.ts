function privateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19))
}

function ipv4FromMappedIpv6(hostname: string): string | null {
  const inner = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!inner.startsWith('::ffff:')) return null
  const tail = inner.slice('::ffff:'.length)
  if (tail.includes('.')) return tail
  const groups = tail.split(':')
  if (groups.length !== 2 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null
  const high = Number.parseInt(groups[0], 16)
  const low = Number.parseInt(groups[1], 16)
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
}

function privateOrLocalIpv6(hostname: string): boolean {
  const inner = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const mapped = ipv4FromMappedIpv6(hostname)
  if (mapped) return privateIpv4(mapped)
  return inner === '::' || inner === '::1' || inner.includes('%')
    || /^(fc|fd)/.test(inner) || /^(fe8|fe9|fea|feb)/.test(inner)
}

/** Canonicalize without fetching. Null means the URL is not safe public evidence. */
export function canonicalCandidateShopUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim().length > 500) return null
  try {
    const url = new URL(raw.trim())
    const hostname = url.hostname.toLowerCase()
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    const isIpv6 = hostname.startsWith('[') && hostname.endsWith(']')
    if (!hostname || (!isIpv6 && !hostname.includes('.')) || hostname === 'localhost'
      || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')
      || privateIpv4(hostname) || (isIpv6 && privateOrLocalIpv6(hostname))) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}
