import 'server-only'

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto'
import { db } from '@/lib/supabase'
import { normalizeLocale, type Locale } from '@/lib/dictionary'
import { SHORTLINK_ORIGIN } from '@/lib/shortlink'
import {
  sendSweepstakesConsolation,
  sendSweepstakesVerificationCode,
  sendSweepstakesWinner,
} from '@/lib/email'
import type {
  SweepstakesCampaign,
  SweepstakesDraw,
  SweepstakesEntry,
  SweepstakesSettings,
  SweepstakesStats,
} from '@/lib/sweepstakes-types'

const CODE_TTL_MS = 15 * 60 * 1000
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

function secret(): string {
  return process.env.SWEEPSTAKES_HASH_SECRET
    ?? process.env.CLERK_SECRET_KEY
    ?? process.env.MEDUSA_INTERNAL_SECRET
    ?? 'dev-sweepstakes-secret'
}

export function cleanEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(email))
}

export function hashSweepstakesEmail(email: string): string {
  return createHmac('sha256', secret()).update(cleanEmail(email)).digest('hex')
}

export function hashVerificationCode(scopeId: string, emailHash: string, code: string): string {
  return createHmac('sha256', secret()).update(`${scopeId}:${emailHash}:${code.trim().toUpperCase()}`).digest('hex')
}

export function safeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export function makeCode(): string {
  let out = ''
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return out
}

export function verificationCodeMatches(scopeId: string, emailHash: string, code: string, expectedHash: string): boolean {
  return safeCompare(hashVerificationCode(scopeId, emailHash, code), expectedHash)
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return ''
  const [local, domain] = cleanEmail(email).split('@')
  if (!domain) return '***'
  const head = local.slice(0, 1)
  return `${head}***@${domain}`
}

// mschz-full-coverage (07, Sprint 1, US-1.3) — the public/shareable sweepstakes
// URL is now the short branded form (mschz.org/g/…); the passthrough (US-1.1)
// 301s it to the identical /g/<slug> page on the platform origin.
export function publicSweepstakesUrl(slug: string, locale?: Locale): string {
  const url = `${SHORTLINK_ORIGIN}/g/${encodeURIComponent(slug)}`
  return locale === 'en' ? `${url}?lang=en` : url
}

export function campaignTitle(campaign: SweepstakesCampaign, locale: Locale): string {
  return (locale === 'en' ? campaign.title_en : campaign.title_es)
    || campaign.title_es
    || campaign.title_en
    || 'Sweepstakes'
}

export function campaignDescription(campaign: SweepstakesCampaign, locale: Locale): string {
  return (locale === 'en' ? campaign.prize_description_en : campaign.prize_description_es)
    || campaign.prize_description_es
    || campaign.prize_description_en
    || ''
}

export function campaignTerms(campaign: SweepstakesCampaign, locale: Locale): string {
  return (locale === 'en' ? campaign.terms_en : campaign.terms_es)
    || campaign.terms_es
    || campaign.terms_en
    || ''
}

export function campaignIsWithinEntryWindow(campaign: Pick<SweepstakesCampaign, 'status' | 'starts_at' | 'ends_at'>, now = new Date()): boolean {
  if (!['scheduled', 'active'].includes(campaign.status)) return false
  if (!campaign.starts_at || !campaign.ends_at) return false
  const t = now.getTime()
  return t >= new Date(campaign.starts_at).getTime() && t < new Date(campaign.ends_at).getTime()
}

export async function getSweepstakesSettings(): Promise<SweepstakesSettings> {
  const { data, error } = await db
    .from('marketplace_sweepstakes_settings')
    .select('enabled, disabled_reason')
    .eq('id', 1)
    .maybeSingle()

  if (error || !data) {
    return { enabled: false, disabled_reason: 'Sweepstakes are not configured.' }
  }
  return {
    enabled: data.enabled !== false,
    disabled_reason: data.disabled_reason ?? null,
  }
}

export async function getCampaignBySlug(slug: string): Promise<SweepstakesCampaign | null> {
  const { data, error } = await db
    .from('marketplace_sweepstakes_campaigns')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()
  if (error || !data) return null
  return data as SweepstakesCampaign
}

export async function getCampaignStats(campaignId: string): Promise<SweepstakesStats> {
  const [{ count: entries }, { count: tickets }] = await Promise.all([
    db.from('marketplace_sweepstakes_entries').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId),
    db.from('marketplace_sweepstakes_tickets').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).is('voided_at', null),
  ])
  return { entries: entries ?? 0, tickets: tickets ?? 0 }
}

export function validatePublishGate(input: Partial<SweepstakesCampaign> & { attested?: boolean }): string[] {
  const missing: string[] = []
  const required: Array<[keyof SweepstakesCampaign, string]> = [
    ['title_es', 'title_es'],
    ['title_en', 'title_en'],
    ['prize_description_es', 'prize_description_es'],
    ['prize_description_en', 'prize_description_en'],
    ['terms_es', 'terms_es'],
    ['terms_en', 'terms_en'],
    ['starts_at', 'starts_at'],
    ['ends_at', 'ends_at'],
    ['organizer_name', 'organizer_name'],
    ['organizer_contact', 'organizer_contact'],
    ['permit_reference', 'permit_reference'],
  ]
  for (const [key, label] of required) {
    const value = input[key]
    if (typeof value !== 'string' || value.trim().length === 0) missing.push(label)
  }
  if (!input.attested && !input.compliance_attested_at) missing.push('attestation')
  if (input.starts_at && input.ends_at && new Date(input.ends_at).getTime() <= new Date(input.starts_at).getTime()) {
    missing.push('valid_date_range')
  }
  if (input.ends_at && new Date(input.ends_at).getTime() <= Date.now()) {
    missing.push('future_end_date')
  }
  return missing
}

export function slugifySweepstakes(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    || `sorteo-${randomBytes(3).toString('hex')}`
}

export async function uniqueSweepstakesSlug(input: string): Promise<string> {
  const base = slugifySweepstakes(input)
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`
    const { data } = await db
      .from('marketplace_sweepstakes_campaigns')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()
    if (!data) return slug
  }
  return `${base}-${Date.now().toString(36)}`
}

export async function sendSweepstakesCode(campaign: SweepstakesCampaign, email: string, localeInput?: string | null): Promise<void> {
  const normalized = cleanEmail(email)
  const locale = normalizeLocale(localeInput)
  const emailHash = hashSweepstakesEmail(normalized)
  const code = makeCode()
  const codeHash = hashVerificationCode(campaign.id, emailHash, code)

  await db.from('marketplace_sweepstakes_email_verifications').insert({
    campaign_id: campaign.id,
    email_hash: emailHash,
    email: normalized,
    code_hash: codeHash,
    locale,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })

  await sendSweepstakesVerificationCode({
    to: normalized,
    code,
    locale,
    campaignTitle: campaignTitle(campaign, locale),
    campaignUrl: publicSweepstakesUrl(campaign.slug, locale),
  })
}

export async function verifySweepstakesCode(campaign: SweepstakesCampaign, email: string, code: string): Promise<boolean> {
  const normalized = cleanEmail(email)
  const emailHash = hashSweepstakesEmail(normalized)
  const { data } = await db
    .from('marketplace_sweepstakes_email_verifications')
    .select('id, code_hash, attempts, expires_at, consumed_at')
    .eq('campaign_id', campaign.id)
    .eq('email_hash', emailHash)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data || data.consumed_at || data.attempts >= 5 || new Date(data.expires_at).getTime() < Date.now()) return false

  const expected = hashVerificationCode(campaign.id, emailHash, code)
  const ok = safeCompare(expected, data.code_hash)
  await db
    .from('marketplace_sweepstakes_email_verifications')
    .update({
      attempts: (data.attempts ?? 0) + 1,
      ...(ok ? { consumed_at: new Date().toISOString() } : {}),
    })
    .eq('id', data.id)

  return ok
}

async function ensureTickets(input: {
  campaignId: string
  entryId: string
  count: number
  source: 'free_entry' | 'purchase_bonus'
  awardPrefix: string
  sourceRef?: string | null
  metadata?: Record<string, unknown>
}): Promise<number> {
  const count = Math.max(0, Math.floor(input.count))
  if (count <= 0) return 0

  const rows = Array.from({ length: count }, (_, i) => ({
    campaign_id: input.campaignId,
    entry_id: input.entryId,
    source: input.source,
    award_key: `${input.awardPrefix}:${i + 1}`,
    source_ref: input.sourceRef ?? null,
    metadata: input.metadata ?? {},
  }))

  const { error } = await db
    .from('marketplace_sweepstakes_tickets')
    .upsert(rows, { onConflict: 'campaign_id,award_key', ignoreDuplicates: true })
  if (error) {
    console.error('[sweepstakes] ticket upsert failed:', error.message)
    return 0
  }

  const { count: total } = await db
    .from('marketplace_sweepstakes_tickets')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', input.campaignId)
    .eq('entry_id', input.entryId)
    .eq('source', input.source)
    .like('award_key', `${input.awardPrefix}:%`)
    .is('voided_at', null)

  return total ?? 0
}

export async function createOrReturnSweepstakesEntry(input: {
  campaign: SweepstakesCampaign
  name: string
  email: string
  locale?: string | null
}): Promise<{ entry: SweepstakesEntry; ticketCount: number }> {
  const email = cleanEmail(input.email)
  const emailHash = hashSweepstakesEmail(email)
  const locale = normalizeLocale(input.locale)
  const now = new Date().toISOString()

  const { data, error } = await db
    .from('marketplace_sweepstakes_entries')
    .upsert({
      campaign_id: input.campaign.id,
      name: input.name.trim(),
      email,
      email_hash: emailHash,
      locale,
      verified_at: now,
    }, { onConflict: 'campaign_id,email_hash' })
    .select('*')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'entry failed')

  const entry = data as SweepstakesEntry
  await ensureTickets({
    campaignId: input.campaign.id,
    entryId: entry.id,
    count: input.campaign.free_ticket_value,
    source: 'free_entry',
    awardPrefix: `free:${entry.id}`,
    sourceRef: entry.id,
  })

  return { entry, ticketCount: await getEntryTicketCount(entry.id) }
}

export async function getEntryTicketCount(entryId: string): Promise<number> {
  const { count } = await db
    .from('marketplace_sweepstakes_tickets')
    .select('id', { count: 'exact', head: true })
    .eq('entry_id', entryId)
    .is('voided_at', null)
  return count ?? 0
}

export async function awardSweepstakesPurchaseBonusForOrder(input: {
  sellerId?: string | null
  orderId?: string | null
  buyerEmail?: string | null
  paidAt?: string | null
  status?: string | null
}): Promise<{ campaigns: number; tickets: number }> {
  const settings = await getSweepstakesSettings()
  if (!settings.enabled || !input.sellerId || !input.orderId || !input.buyerEmail || !isValidEmail(input.buyerEmail)) {
    return { campaigns: 0, tickets: 0 }
  }
  if (input.status === 'refunded') return { campaigns: 0, tickets: 0 }

  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date()
  const paidIso = paidAt.toISOString()
  const emailHash = hashSweepstakesEmail(input.buyerEmail)

  const { data: campaigns, error } = await db
    .from('marketplace_sweepstakes_campaigns')
    .select('*')
    .eq('medusa_seller_id', input.sellerId)
    .eq('purchase_bonus_enabled', true)
    .in('status', ['scheduled', 'active'])
    .lte('starts_at', paidIso)
    .gt('ends_at', paidIso)

  if (error || !campaigns?.length) return { campaigns: 0, tickets: 0 }

  let campaignHits = 0
  let ticketHits = 0
  for (const campaign of campaigns as SweepstakesCampaign[]) {
    const { data: entry } = await db
      .from('marketplace_sweepstakes_entries')
      .select('*')
      .eq('campaign_id', campaign.id)
      .eq('email_hash', emailHash)
      .maybeSingle()

    if (!entry) continue
    const inserted = await ensureTickets({
      campaignId: campaign.id,
      entryId: (entry as SweepstakesEntry).id,
      count: campaign.purchase_ticket_value,
      source: 'purchase_bonus',
      awardPrefix: `purchase:${input.orderId}`,
      sourceRef: input.orderId,
      metadata: { order_id: input.orderId, seller_id: input.sellerId },
    })
    if (inserted > 0) {
      campaignHits++
      ticketHits += inserted
    }
  }
  return { campaigns: campaignHits, tickets: ticketHits }
}

export async function awardSweepstakesPurchaseBonusFromOrderMirror(medusaOrderId: string): Promise<{ campaigns: number; tickets: number }> {
  const { data } = await db
    .from('marketplace_orders')
    .select('id, shop_id, buyer_email, status, created_at, metadata')
    .filter('metadata->>medusa_order_id', 'eq', medusaOrderId)
    .maybeSingle()

  if (!data) return { campaigns: 0, tickets: 0 }
  return awardSweepstakesPurchaseBonusForOrder({
    sellerId: data.shop_id as string,
    orderId: medusaOrderId,
    buyerEmail: data.buyer_email as string | null,
    status: data.status as string | null,
    paidAt: data.created_at as string | null,
  })
}

async function orderIsRefunded(sourceRef: string): Promise<boolean> {
  const byMedusa = await db
    .from('marketplace_orders')
    .select('status')
    .filter('metadata->>medusa_order_id', 'eq', sourceRef)
    .maybeSingle()
  if (byMedusa.data?.status === 'refunded') return true

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceRef)) {
    const byId = await db.from('marketplace_orders').select('status').eq('id', sourceRef).maybeSingle()
    return byId.data?.status === 'refunded'
  }
  return false
}

async function voidRefundedPurchaseTickets(campaignId: string): Promise<number> {
  const { data: refs } = await db
    .from('marketplace_sweepstakes_tickets')
    .select('source_ref')
    .eq('campaign_id', campaignId)
    .eq('source', 'purchase_bonus')
    .is('voided_at', null)

  const uniqueRefs = Array.from(new Set((refs ?? []).map((r) => r.source_ref).filter(Boolean) as string[]))
  let voided = 0
  for (const ref of uniqueRefs) {
    if (!(await orderIsRefunded(ref))) continue
    const { count } = await db
      .from('marketplace_sweepstakes_tickets')
      .update({ voided_at: new Date().toISOString() }, { count: 'exact' })
      .eq('campaign_id', campaignId)
      .eq('source_ref', ref)
      .is('voided_at', null)
    voided += count ?? 0
  }
  return voided
}

export async function drawSweepstakesCampaign(
  campaignId: string,
  opts: { notifyWinner?: boolean } = {},
): Promise<SweepstakesDraw | null> {
  const { data: existingDraw } = await db
    .from('marketplace_sweepstakes_draws')
    .select('*')
    .eq('campaign_id', campaignId)
    .maybeSingle()
  if (existingDraw) return existingDraw as SweepstakesDraw

  const { data: campaign } = await db
    .from('marketplace_sweepstakes_campaigns')
    .select('*')
    .eq('id', campaignId)
    .maybeSingle()
  if (!campaign) return null

  await voidRefundedPurchaseTickets(campaignId)

  const { data: tickets } = await db
    .from('marketplace_sweepstakes_tickets')
    .select('id, entry_id')
    .eq('campaign_id', campaignId)
    .is('voided_at', null)

  const pool = (tickets ?? []).sort((a, b) => String(a.id).localeCompare(String(b.id)))
  if (pool.length === 0) {
    await db.from('marketplace_sweepstakes_campaigns').update({
      status: 'completed',
      draw_completed_at: new Date().toISOString(),
      draw_audit: { result: 'no_eligible_tickets', algorithm_version: 'v1-secure-random-index' },
    }).eq('id', campaignId)
    return null
  }

  const poolHash = createHash('sha256').update(pool.map((t) => t.id).join('|')).digest('hex')
  const randomNonce = randomBytes(32).toString('hex')
  const winningIndex = randomInt(pool.length)
  const winning = pool[winningIndex]

  const { data: inserted, error } = await db
    .from('marketplace_sweepstakes_draws')
    .insert({
      campaign_id: campaignId,
      winning_ticket_id: winning.id,
      winning_entry_id: winning.entry_id,
      ticket_count: pool.length,
      pool_hash: poolHash,
      random_nonce: randomNonce,
      random_value: String(winningIndex),
      algorithm_version: 'v1-secure-random-index',
    })
    .select('*')
    .maybeSingle()

  if (error || !inserted) {
    const { data: raced } = await db
      .from('marketplace_sweepstakes_draws')
      .select('*')
      .eq('campaign_id', campaignId)
      .maybeSingle()
    return (raced as SweepstakesDraw | null) ?? null
  }

  const { data: entry } = await db
    .from('marketplace_sweepstakes_entries')
    .select('email, locale')
    .eq('id', winning.entry_id)
    .maybeSingle()

  const draw = inserted as SweepstakesDraw
  const masked = maskEmail(entry?.email)
  await db.from('marketplace_sweepstakes_campaigns').update({
    status: 'completed',
    winner_entry_id: draw.winning_entry_id,
    winner_ticket_id: draw.winning_ticket_id,
    winner_masked_contact: masked,
    draw_completed_at: draw.created_at,
    draw_audit: {
      ticket_count: draw.ticket_count,
      pool_hash: draw.pool_hash,
      random_nonce: draw.random_nonce,
      random_value: draw.random_value,
      algorithm_version: draw.algorithm_version,
    },
  }).eq('id', campaignId)

  if (opts.notifyWinner !== false && entry?.email) {
    await sendSweepstakesWinner({
      to: entry.email,
      locale: normalizeLocale(entry.locale),
      campaignTitle: campaignTitle(campaign as SweepstakesCampaign, normalizeLocale(entry.locale)),
      campaignUrl: publicSweepstakesUrl((campaign as SweepstakesCampaign).slug, normalizeLocale(entry.locale)),
    })
  }

  return draw
}

export async function runSweepstakesDrawCron(): Promise<{ scanned: number; drawn: number; disabled: boolean }> {
  const settings = await getSweepstakesSettings()
  if (!settings.enabled) return { scanned: 0, drawn: 0, disabled: true }

  const now = new Date().toISOString()
  const { data: campaigns } = await db
    .from('marketplace_sweepstakes_campaigns')
    .select('id')
    .in('status', ['scheduled', 'active'])
    .lte('ends_at', now)

  let drawn = 0
  for (const row of campaigns ?? []) {
    await drawSweepstakesCampaign(row.id)
    drawn++
  }
  return { scanned: campaigns?.length ?? 0, drawn, disabled: false }
}

export async function sendSweepstakesConsolationBroadcast(input: {
  campaign: SweepstakesCampaign
  messageEs: string
  messageEn: string
  couponCode?: string | null
  createdBy: string
}): Promise<{ sent: number }> {
  const settings = await getSweepstakesSettings()
  if (!settings.enabled) throw new Error('disabled')
  if (input.campaign.consolation_sent_at) return { sent: 0 }

  const { data: winner } = input.campaign.winner_entry_id
    ? await db.from('marketplace_sweepstakes_entries').select('id').eq('id', input.campaign.winner_entry_id).maybeSingle()
    : { data: null }

  const { data: entries } = await db
    .from('marketplace_sweepstakes_entries')
    .select('id, email, locale')
    .eq('campaign_id', input.campaign.id)

  let sent = 0
  for (const entry of entries ?? []) {
    if (winner?.id && entry.id === winner.id) continue
    await sendSweepstakesConsolation({
      to: entry.email,
      locale: normalizeLocale(entry.locale),
      campaignTitle: campaignTitle(input.campaign, normalizeLocale(entry.locale)),
      message: normalizeLocale(entry.locale) === 'en' ? input.messageEn : input.messageEs,
      couponCode: input.couponCode ?? null,
      campaignUrl: publicSweepstakesUrl(input.campaign.slug, normalizeLocale(entry.locale)),
    })
    sent++
  }

  await db.from('marketplace_sweepstakes_broadcasts').insert({
    campaign_id: input.campaign.id,
    message_es: input.messageEs,
    message_en: input.messageEn,
    coupon_code: input.couponCode ?? null,
    sent_count: sent,
    created_by: input.createdBy,
  })
  await db.from('marketplace_sweepstakes_campaigns').update({ consolation_sent_at: new Date().toISOString() }).eq('id', input.campaign.id)

  return { sent }
}
