export type RecruitingPartnerIdentity = {
  program_track: 'promoter' | 'founding_operator'
}

export type PartnerRecruitingPreflight<T extends RecruitingPartnerIdentity> =
  | { kind: 'recruiting_enabled' }
  | { kind: 'partner_preflight_limited' }
  | { kind: 'partner_absent' }
  | { kind: 'partner_admitted'; partner: T }
  | { kind: 'operator_rolled_back'; partner: T }

/**
 * Pure orchestration seam for the MCP pre-rate-limit identity check.
 * Rejected storage promises deliberately propagate: unavailable identity
 * storage is neither a confirmed absence nor permission to consume a bucket.
 */
export async function resolvePartnerRecruitingPreflight<T extends RecruitingPartnerIdentity>(deps: {
  loadPartner: () => Promise<T | null>
  recruitingV3Enabled: () => Promise<boolean>
  identityLookupAllowed?: () => Promise<boolean>
}): Promise<PartnerRecruitingPreflight<T>> {
  // Normal ON operation adds no identity read. The authoritative resolver
  // still rechecks after parsing; only OFF needs the track to distinguish a
  // rolled-back operator from a Promotor whose existing path must continue.
  if (await deps.recruitingV3Enabled()) return { kind: 'recruiting_enabled' }
  if (deps.identityLookupAllowed && !(await deps.identityLookupAllowed())) {
    return { kind: 'partner_preflight_limited' }
  }
  const partner = await deps.loadPartner()
  if (!partner) return { kind: 'partner_absent' }
  if (partner.program_track !== 'founding_operator') return { kind: 'partner_admitted', partner }
  return { kind: 'operator_rolled_back', partner }
}
