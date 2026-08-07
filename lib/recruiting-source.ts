import type { RecruitingSource } from '@/lib/recruiting-events'

/** Collapse a public query value to the approved coarse analytics vocabulary. */
export function coarseRecruitingSource(value: string | string[] | undefined): RecruitingSource {
  if (value === undefined) return 'direct'
  if (value === 'internal' || value === 'campaign' || value === 'direct') return value
  return 'unknown'
}
