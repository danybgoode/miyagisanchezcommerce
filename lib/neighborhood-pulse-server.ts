import { db } from '@/lib/supabase'
import type { PrintSocialSubmission } from '@/lib/print'
import {
  isNeighborhoodPulseSocialItem,
  NEIGHBORHOOD_PULSE_SOCIAL_STATUSES,
} from '@/lib/neighborhood-pulse'

export async function getNeighborhoodPulseItems(limit = 24): Promise<PrintSocialSubmission[]> {
  const { data, error } = await db
    .from('print_social_submissions')
    .select('*')
    .in('status', [...NEIGHBORHOOD_PULSE_SOCIAL_STATUSES])
    .eq('web_visible', true)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.warn('[neighborhood-pulse] feed unavailable:', error.message)
    return []
  }

  return ((data ?? []) as PrintSocialSubmission[])
    .filter(isNeighborhoodPulseSocialItem)
    .slice(0, limit)
}
