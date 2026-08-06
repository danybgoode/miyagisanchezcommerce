import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { canonicalCandidateShopUrl } from '../lib/candidate-shop-url'
import { validateApplicationInput } from '../lib/promoter-applications'
import { buildRecruitingAnalyticsPayload } from '../lib/recruiting-events'
import { coarseRecruitingSource } from '../lib/recruiting-source'
import { isPromoterEconomicIdentity } from '../lib/promoter'

const ROOT = process.cwd()
const PARTNER_IDENTITY_BY_CLERK_ID_CONSUMERS = [
  'app/(shell)/partner/page.tsx',
  'lib/portfolio/draft-server.ts',
  'lib/relationship-access.ts',
] as const
const PROMOTER_IDENTITY_BY_CLERK_ID_CONSUMERS = [
  'app/(shell)/promotor/cerrar/page.tsx',
  'app/(shell)/vende/promotor/page.tsx',
  'app/api/promoter/claim/link/route.ts',
  'app/api/promoter/close/domain/route.ts',
  'app/api/promoter/close/listing/route.ts',
  'app/api/promoter/close/migration/route.ts',
  'app/api/promoter/close/ml-sync/route.ts',
  'app/api/promoter/close/print/route.ts',
  'app/api/promoter/close/subdomain/route.ts',
  'app/api/promoter/close/transfer/[id]/report/route.ts',
  'app/api/promoter/close/transfer/route.ts',
  'app/api/promoter/preview/activate/route.ts',
  'app/api/promoter/preview/route.ts',
  'app/api/promoter/rate-card/route.ts',
  'app/api/promoter/shop/setup/route.ts',
] as const
const PARTNER_IDENTITY_BY_ID_CONSUMERS = [
  'lib/portfolio/partner-portfolio-auth.ts',
] as const
const PROMOTER_IDENTITY_BY_ID_CONSUMERS = [
  'app/api/admin/promoter/transfers/[id]/approve/route.ts',
  'app/api/admin/promoter/transfers/[id]/reject/route.ts',
  'lib/promoter-close-notify.ts',
] as const

function sourceFilesBelow(relativeDirectory: string): string[] {
  const found: string[] = []
  const visit = (relativePath: string) => {
    for (const entry of fs.readdirSync(path.join(ROOT, relativePath), { withFileTypes: true })) {
      const child = path.join(relativePath, entry.name)
      if (entry.isDirectory()) visit(child)
      else if (/\.tsx?$/.test(entry.name)) found.push(child)
    }
  }
  visit(relativeDirectory)
  return found
}

const SHOPS = [1, 2, 3].map((n) => ({
  url: `https://shop-${n}.example/products`, platform: 'shopify', channels: ['online_store'], merchant_awareness: 'not_contacted',
}))
const VALID = {
  name: 'Operator Example', email: 'OPERATOR@EXAMPLE.COM', whatsapp: '+1 212 555 0100', website: '',
  program_track: 'founding_operator', operator_details_version: 1,
  operator_details: {
    company_name: 'Example Practice', operator_role: 'Principal', active_shop_count: 5,
    candidate_shops: SHOPS, recent_operating_problem: 'Inventory exceptions repeat across stores.',
    must_retain_systems: 'Merchant-owned domains and ERP.', why_now: 'The team needs a bounded parallel proof.', checkpoint_90_day: true,
  },
} as const

test.describe('partners recruiting v3 · operator contract', () => {
  test('accepts and canonicalizes exactly three version-1 shop records', () => {
    const result = validateApplicationInput(VALID)
    expect(result.ok).toBe(true)
    if (result.ok && 'program_track' in result.clean) {
      expect(result.clean.program_track).toBe('founding_operator')
      expect(result.clean.email).toBe('operator@example.com')
      expect(result.clean.operator_details.candidate_shops).toHaveLength(3)
      expect(result.clean.operator_details.candidate_shops[0].url).toBe('https://shop-1.example/products')
    }
  })

  test('rejects two/four shops, fewer than three active shops, unknown keys and incomplete qualification', () => {
    for (const candidate_shops of [SHOPS.slice(0, 2), [...SHOPS, SHOPS[0]]]) {
      expect(validateApplicationInput({ ...VALID, operator_details: { ...VALID.operator_details, candidate_shops } })).toEqual({ ok: false, reason: 'shop_count' })
    }
    expect(validateApplicationInput({ ...VALID, operator_details: { ...VALID.operator_details, active_shop_count: 2 } })).toEqual({ ok: false, reason: 'shop_count' })
    expect(validateApplicationInput({ ...VALID, operator_details: { ...VALID.operator_details, active_shop_count: 10001 } })).toEqual({ ok: false, reason: 'qualification' })
    expect(validateApplicationInput({ ...VALID, secret: 'nope' })).toEqual({ ok: false, reason: 'invalid_payload' })
    expect(validateApplicationInput({ ...VALID, operator_details: { ...VALID.operator_details, password: 'nope' } })).toEqual({ ok: false, reason: 'invalid_payload' })
    expect(validateApplicationInput({ ...VALID, operator_details: { ...VALID.operator_details, checkpoint_90_day: false } })).toEqual({ ok: false, reason: 'qualification' })
  })

  test('requires three distinct canonical shops and rejects unknown program tracks', () => {
    expect(validateApplicationInput({ ...VALID, operator_details: { ...VALID.operator_details, candidate_shops: [SHOPS[0], SHOPS[0], SHOPS[0]] } })).toEqual({ ok: false, reason: 'shop_url' })
    expect(validateApplicationInput({ name: 'X', email: 'x@example.com', whatsapp: '555', program_track: 'operator' })).toEqual({ ok: false, reason: 'invalid_payload' })
    expect(validateApplicationInput({ name: 'X', email: 'x@example.com', whatsapp: '555', program_track: '' })).toEqual({ ok: false, reason: 'invalid_payload' })
  })

  test('public URL contract canonicalizes and rejects credentials/local/private schemes without fetching', () => {
    expect(canonicalCandidateShopUrl(' HTTPS://Example.COM/path#private ')).toBe('https://example.com/path')
    for (const value of ['ftp://example.com', 'https://user:pass@example.com', 'https://intranet', 'http://localhost:3000', 'http://127.0.0.1', 'http://10.1.2.3', 'http://192.168.1.1', 'http://[::1]', 'http://[fd00::1]', 'http://[fe80::1]', 'http://[::ffff:192.168.1.1]', 'http://[::ffff:c0a8:101]', 'not a url']) {
      expect(canonicalCandidateShopUrl(value), value).toBeNull()
    }
  })

  test('legacy Promotor validation remains byte-compatible when track is absent', () => {
    expect(validateApplicationInput({ name: ' Test ', email: 'TEST@example.com', whatsapp: ' 555 ', city: ' CDMX ', motivation: ' Hola ' })).toEqual({
      ok: true, clean: { name: 'Test', email: 'test@example.com', whatsapp: '555', city: 'CDMX', motivation: 'Hola' },
    })
  })
})

test.describe('partners recruiting v3 · privacy-closed measurement', () => {
  test('builds only the fixed coarse vocabulary', () => {
    expect(buildRecruitingAnalyticsPayload({ event: 'application_submitted', track: 'founding_operator', source: 'campaign' })).toEqual({
      event: 'partners_recruiting_application_submitted', recruitment_track: 'founding_operator', funnel_stage: 'application_submitted', recruitment_source: 'campaign',
    })
    expect(buildRecruitingAnalyticsPayload({ event: 'application_disqualified', track: 'promoter', source: 'internal', reason: 'shop_count' })).toMatchObject({ disqualification_reason: 'shop_count' })
  })

  test('maps query attribution to the coarse source allowlist only', () => {
    expect(coarseRecruitingSource(undefined)).toBe('direct')
    expect(coarseRecruitingSource('internal')).toBe('internal')
    expect(coarseRecruitingSource('campaign')).toBe('campaign')
    expect(coarseRecruitingSource('newsletter-person@example.com')).toBe('unknown')
    expect(coarseRecruitingSource(['campaign'])).toBe('unknown')
  })

  test('drops URL/contact/free-text/merchant keys and unknown enum values at runtime', () => {
    for (const payload of [
      { event: 'view', track: 'founding_operator', source: 'direct', url: 'https://secret.example' },
      { event: 'view', track: 'founding_operator', source: 'direct', email: 'person@example.com' },
      { event: 'view', track: 'founding_operator', source: 'direct', company_name: 'Private' },
      { event: 'view', track: 'founding_operator', source: 'utm_campaign' },
      { event: 'anything', track: 'founding_operator', source: 'direct' },
    ]) expect(buildRecruitingAnalyticsPayload(payload)).toBeNull()
  })
})

test.describe('partners recruiting v3 · schema, gate and population guards', () => {
  test('migration is additive, defaults both tracks to promoter, keeps the flag dark and locks SQL functions to service_role', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20260806120000_miyagi_partners_recruiting_v3.sql'), 'utf8')
    expect(sql.match(/program_track TEXT NOT NULL DEFAULT 'promoter'/g)).toHaveLength(2)
    expect(sql).toContain("program_track IN ('promoter', 'founding_operator')")
    expect(sql).toContain("status IN ('pending', 'approved', 'rejected')")
    expect(sql).toContain("status IN ('pending', 'approved')")
    expect(sql).toContain("'partners.recruiting_v3_enabled', false")
    expect(sql.match(/SECURITY DEFINER/g)).toHaveLength(5)
    expect(sql.match(/SET search_path = public, pg_temp/g)).toHaveLength(5)
    expect(sql.match(/TO service_role/g)).toHaveLength(5)
    expect(sql).toContain("p_activation_token_hash !~ '^[0-9a-f]{64}$'")
    expect(sql).toContain("invitation_provider_status IN ('pending', 'provider_accepted', 'unconfirmed')")
    expect(sql).toContain("invitation_provider_status = 'pending'")
    expect(sql).toContain('CREATE OR REPLACE FUNCTION miyagi_rotate_founding_operator_invitation')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION miyagi_record_founding_operator_invitation_outcome')
    expect(sql).toContain("p_provider_outcome NOT IN ('provider_accepted', 'unconfirmed')")
    expect(sql).toContain('invitation_provider_accepted_at')
    expect(sql).not.toContain('invitation_delivered_at')
    expect(sql).toContain('AND activation_token_hash = p_activation_token_hash')
    expect(sql).toContain('coalesce(invitation_attempt_count, 0) + 1')
    expect(sql).toContain('IF v_application.invitation_provider_status = p_provider_outcome THEN')
    expect(sql).toContain("IF v_application.invitation_provider_status <> 'pending' THEN")
    expect(sql.indexOf('IF v_application.invitation_provider_status = p_provider_outcome THEN')).toBeLessThan(sql.indexOf('coalesce(invitation_attempt_count, 0) + 1'))
    expect(sql.indexOf("IF v_application.invitation_provider_status <> 'pending' THEN")).toBeLessThan(sql.indexOf('coalesce(invitation_attempt_count, 0) + 1'))
    expect(sql).toContain('p_verified_emails TEXT[]')
    expect(sql).toContain('lower(btrim(verified_email)) = lower(btrim(v_application.email))')
    expect(sql.indexOf('activation_principal_mismatch')).toBeLessThan(sql.indexOf('PERFORM miyagi_bind_partner_identity'))
    expect(sql).toContain('REVOKE ALL ON FUNCTION miyagi_activate_founding_operator(TEXT, TEXT, TEXT[]) FROM PUBLIC, anon, authenticated')
  })

  test('one server resolver gates the public page and operator intake while legacy page remains present', () => {
    const resolver = fs.readFileSync(path.join(ROOT, 'lib/recruiting-v3.ts'), 'utf8')
    const page = fs.readFileSync(path.join(ROOT, 'app/(site)/us/page.tsx'), 'utf8')
    const route = fs.readFileSync(path.join(ROOT, 'app/api/promoter/apply/route.ts'), 'utf8')
    const rejectRoute = fs.readFileSync(path.join(ROOT, 'app/api/admin/promoter/applications/[id]/reject/route.ts'), 'utf8')
    expect(resolver).toContain("isEnabled('partners.recruiting_v3_enabled')")
    expect(page).toContain('LegacyUnitedStatesPilotPage')
    expect(page).toContain('MiyagiPartnersRecruitingPage')
    expect(page).toContain("export const dynamic = 'force-dynamic'")
    expect(route).toContain('if (operatorTrack && !(await recruitingV3Enabled()))')
    expect(route.indexOf("checkRateLimit('promoter_apply'")).toBeLessThan(route.indexOf('await req.json()'))
    expect(route.indexOf('await req.json()')).toBeLessThan(route.indexOf('if (operatorTrack && !(await recruitingV3Enabled()))'))
    expect(route).toContain("operatorTrack ? { ok: true, received: true, duplicate: !created } : { ok: true }")
    expect(rejectRoute).toContain("application?.program_track === 'founding_operator' && !(await recruitingV3Enabled())")
    expect(rejectRoute.indexOf('getPromoterApplication(id)')).toBeLessThan(rejectRoute.indexOf('rejectPromoterApplication(id)'))
  })

  test('operator intake and review cannot create grants/consent or expose activation hashes', () => {
    const intake = fs.readFileSync(path.join(ROOT, 'lib/promoter-applications.ts'), 'utf8')
    const admin = fs.readFileSync(path.join(ROOT, 'app/(shell)/admin/promoter/PromoterAdminClient.tsx'), 'utf8')
    const form = fs.readFileSync(path.join(ROOT, 'app/(site)/us/FoundingOperatorApplication.tsx'), 'utf8')
    expect(intake).not.toContain("from('partner_grants')")
    expect(intake).not.toMatch(/relationship|consent/i)
    expect(admin).toContain('rel="noopener noreferrer"')
    expect(admin).toContain('merchantAwarenessLabel(shop.merchant_awareness)')
    for (const hardcodedEnglish of ['Practice', 'Active shops', 'Confirmed', 'Request conversation', 'Nomination is not merchant consent.']) {
      expect(admin, hardcodedEnglish).not.toContain(hardcodedEnglish)
    }
    expect(form).toContain('new Set(normalizedShops.map((shop) => shop.url)).size !== 3')
    expect(admin).not.toContain('activation_token_hash')
  })

  test('the exact legacy identity/economic callsite inventory is classified and track-safe', () => {
    const promoter = fs.readFileSync(path.join(ROOT, 'lib/promoter.ts'), 'utf8')
    const autoGrant = fs.readFileSync(path.join(ROOT, 'lib/partner-grant-server.ts'), 'utf8')
    const applications = fs.readFileSync(path.join(ROOT, 'lib/promoter-applications.ts'), 'utf8')
    const functionBlocks = [...promoter.matchAll(/export async function (\w+)[\s\S]*?(?=\nexport (?:async )?function |\nexport (?:interface|type|const) |$)/g)]
      .filter((match) => match[0].includes(".from('marketplace_promoters')"))
    expect(promoter.match(/\.from\('marketplace_promoters'\)/g) ?? []).toHaveLength(functionBlocks.length)
    expect(functionBlocks.map((match) => match[1]).sort()).toEqual([
      'accrueCommissionForAttribution', 'bindPromoterClerkId', 'createPromoter', 'getPromoterByClerkId',
      'getPartnerIdentityByClerkId', 'getPartnerIdentityById', 'getPromoterByCode', 'getPromoterById', 'listPromoters',
    ].sort())
    for (const [name, body] of functionBlocks.map((match) => [match[1], match[0]] as const)) {
      if (name === 'createPromoter') expect(body).toContain(".insert({ code, name: cleanName, program_track: 'promoter' })")
      else if (name === 'getPartnerIdentityByClerkId' || name === 'getPartnerIdentityById') {
        expect(body).toContain(".select('id, code, name, clerk_user_id, program_track, created_at')")
        expect(body).not.toContain(".eq('program_track', 'promoter')")
      } else expect(body, name).toContain(".eq('program_track', 'promoter')")
    }

    const resolverCalls = /\b(?:getPartnerIdentityByClerkId|getPromoterByClerkId|getPartnerIdentityById|getPromoterById)\s*\(/
    const consumerFiles = [...sourceFilesBelow('app'), ...sourceFilesBelow('lib')]
      .filter((file) => file !== 'lib/promoter.ts')
      .filter((file) => resolverCalls.test(fs.readFileSync(path.join(ROOT, file), 'utf8')))
      .sort()
    expect(consumerFiles).toEqual([
      ...PARTNER_IDENTITY_BY_CLERK_ID_CONSUMERS,
      ...PROMOTER_IDENTITY_BY_CLERK_ID_CONSUMERS,
      ...PARTNER_IDENTITY_BY_ID_CONSUMERS,
      ...PROMOTER_IDENTITY_BY_ID_CONSUMERS,
    ].sort())
    for (const file of PARTNER_IDENTITY_BY_CLERK_ID_CONSUMERS) {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
      expect(source, file).toMatch(/\bgetPartnerIdentityByClerkId\s*\(/)
      expect(source, file).not.toMatch(/\bgetPromoterByClerkId\s*\(/)
    }
    for (const file of PROMOTER_IDENTITY_BY_CLERK_ID_CONSUMERS) {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
      expect(source, file).toMatch(/\bgetPromoterByClerkId\s*\(/)
      expect(source, file).not.toMatch(/\bgetPartnerIdentityByClerkId\s*\(/)
    }
    for (const file of PARTNER_IDENTITY_BY_ID_CONSUMERS) {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
      expect(source, file).toMatch(/\bgetPartnerIdentityById\s*\(/)
      expect(source, file).not.toMatch(/\bgetPromoterById\s*\(/)
    }
    for (const file of PROMOTER_IDENTITY_BY_ID_CONSUMERS) {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
      expect(source, file).toMatch(/\bgetPromoterById\s*\(/)
      expect(source, file).not.toMatch(/\bgetPartnerIdentityById\s*\(/)
    }
    expect(autoGrant).toContain(".eq('program_track', 'promoter')")
    expect(applications.indexOf("program_track === 'founding_operator'")).toBeLessThan(applications.indexOf('createPromoter(claimed.name)'))
    expect(applications).toContain("reason: 'operator_approval_unavailable'")
  })

  test('commission economics fail closed when the promoter-track identity is absent', () => {
    expect(isPromoterEconomicIdentity(null)).toBe(false)
    expect(isPromoterEconomicIdentity({ clerk_user_id: null, program_track: 'founding_operator' })).toBe(false)
    expect(isPromoterEconomicIdentity({ clerk_user_id: null, program_track: 'promoter' })).toBe(true)
  })
})
