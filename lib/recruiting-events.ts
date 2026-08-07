'use client'

import { pushAnalyticsEvent } from '@/lib/analytics-events'

export const RECRUITING_EVENT_NAMES = ['view', 'track_selected', 'application_started', 'application_submitted', 'application_disqualified'] as const
export const RECRUITING_TRACKS = ['founding_operator', 'promoter'] as const
export const RECRUITING_SOURCES = ['direct', 'internal', 'campaign', 'unknown'] as const
export const RECRUITING_REASONS = ['shop_count', 'shop_url', 'qualification', 'duplicate', 'rate_limited', 'flag_off', 'unknown'] as const

export type RecruitingEventName = typeof RECRUITING_EVENT_NAMES[number]
export type RecruitingTrack = typeof RECRUITING_TRACKS[number]
export type RecruitingSource = typeof RECRUITING_SOURCES[number]
export type RecruitingReason = typeof RECRUITING_REASONS[number]

export type RecruitingEvent = {
  event: RecruitingEventName
  track: RecruitingTrack
  source: RecruitingSource
  reason?: RecruitingReason
}

const EVENT_KEYS = new Set(['event', 'track', 'source', 'reason'])

/** Runtime-closed builder: unknown keys or enum values yield no analytics event. */
export function buildRecruitingAnalyticsPayload(input: unknown): Record<string, string> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  const row = input as Record<string, unknown>
  if (!Object.keys(row).every((key) => EVENT_KEYS.has(key))) return null
  if (!RECRUITING_EVENT_NAMES.includes(row.event as RecruitingEventName)
    || !RECRUITING_TRACKS.includes(row.track as RecruitingTrack)
    || !RECRUITING_SOURCES.includes(row.source as RecruitingSource)
    || (row.reason !== undefined && !RECRUITING_REASONS.includes(row.reason as RecruitingReason))) return null
  return {
    event: `partners_recruiting_${row.event as string}`,
    recruitment_track: row.track as string,
    funnel_stage: row.event as string,
    recruitment_source: row.source as string,
    ...(row.reason === undefined ? {} : { disqualification_reason: row.reason as string }),
  }
}

export function pushRecruitingEvent(input: RecruitingEvent): void {
  try {
    const payload = buildRecruitingAnalyticsPayload(input)
    if (!payload) return
    const { event, ...params } = payload
    pushAnalyticsEvent(event, params)
  } catch {
    // Measurement is observability. A blocked browser must never block intake.
  }
}
