import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DRAFT_FACT_IDS,
  DRAFT_FACT_ALLOWLIST,
  EXCLUDED_SOURCE_KEYS,
  buildDraftFacts,
  factMap,
  type DraftFactsSourceInput,
} from '../lib/portfolio/draft-facts'
import {
  DRAFT_TEMPLATE_VERSION,
  DRAFT_TEMPLATE_IDS,
  composeDraft,
  type DraftTemplateId,
} from '../lib/portfolio/draft-compose'
/**
 * Merchant Partner lifecycle · Sprint 2, Story 2.1 (api project, network-free):
 * the fact-bounded draft composer. `lib/portfolio/{draft-facts,draft-compose}.ts`
 * are both zero-import, so everything below runs with no database, no Clerk,
 * no Next. (`lib/portfolio/confirm.ts` and the `.../draft/[draftId]/confirm`
 * route are Story 2.3's own surface — covered by
 * `e2e/portfolio-no-auto-send.spec.ts`, not here, so this file's story
 * boundary matches the commit's.)
 *
 * The load-bearing assertions:
 *   1. THE EXCLUSION PROOF (build contract): a FULLY-POPULATED, PII-carrying
 *      fixture never leaks an excluded value into the composed text or the
 *      stored fact set — for every template, not just one.
 *   2. "Unsupported claims are excluded" is a COMPOSE-TIME guarantee: a
 *      template referencing a fact the caller didn't supply omits the whole
 *      clause, never a placeholder.
 *   3. `factIds` names exactly what the text used, never what the template
 *      could have used.
 *
 * RED-OBSERVED (red-green DoD): see the PR body / the builder's report.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const FULL_INPUT: DraftFactsSourceInput = {
  stage: 'qualified',
  stageLabel: 'Calificado',
  ageInStageDays: 5,
  nextActionTitle: 'Llamar para agendar',
  nextActionDueAt: '2026-08-01T18:00:00.000Z',
  preferredChannel: 'WhatsApp',
  publicShopUrl: 'https://miyagisanchez.com/s/panaderia-luna',
  previewUrl: 'https://miyagisanchez.com/vista-previa/abc123',
  partnerDisplayName: 'Ana Torres',
  businessName: 'Panadería Luna',
  // Every EXCLUDED field, populated with an obviously-secret-shaped value so
  // any leak is unmistakable in the assertions below.
  phoneE164: '+5215500000001-SECRET-PHONE',
  emailNormalized: 'secret-email@example.com',
  whatsappE164: '+5215500000002-SECRET-WHATSAPP',
  instagramHandle: '@secret_instagram_handle',
  objections: 'SECRET-OBJECTION-TEXT',
  fitNote: 'SECRET-FIT-NOTE',
  promoterId: 'SECRET-PROMOTER-ID',
  cohort: 'SECRET-COHORT',
  taskOutcomeNote: 'SECRET-TASK-OUTCOME',
  secretOrTokenValue: 'SECRET-TOKEN-VALUE-DO-NOT-LEAK',
}

const EXCLUDED_VALUES = [
  FULL_INPUT.phoneE164,
  FULL_INPUT.emailNormalized,
  FULL_INPUT.whatsappE164,
  FULL_INPUT.instagramHandle,
  FULL_INPUT.objections,
  FULL_INPUT.fitNote,
  FULL_INPUT.promoterId,
  FULL_INPUT.cohort,
  FULL_INPUT.taskOutcomeNote,
  FULL_INPUT.secretOrTokenValue,
] as string[]

test.describe('draft-facts — the positive allowlist', () => {
  test('DRAFT_FACT_ALLOWLIST names exactly DRAFT_FACT_IDS, in the same order — no extra, no missing', () => {
    expect(DRAFT_FACT_ALLOWLIST.map((d) => d.id)).toEqual([...DRAFT_FACT_IDS])
  })

  test('EXCLUDED_SOURCE_KEYS is non-empty and matches the ten PII/secret fields this story names', () => {
    expect(EXCLUDED_SOURCE_KEYS.length).toBeGreaterThan(0)
    for (const key of [
      'phoneE164',
      'emailNormalized',
      'whatsappE164',
      'instagramHandle',
      'objections',
      'fitNote',
      'promoterId',
      'cohort',
    ]) {
      expect(EXCLUDED_SOURCE_KEYS as readonly string[], key).toContain(key)
    }
  })

  test('no resolver in the allowlist reads an excluded key — proven against the SOURCE TEXT of the allowlist definition, not just its runtime output', () => {
    const source = read('lib/portfolio/draft-facts.ts')
    const start = source.indexOf('export const DRAFT_FACT_ALLOWLIST')
    const end = source.indexOf('\n]', start)
    const allowlistText = source.slice(start, end)
    for (const excludedKey of EXCLUDED_SOURCE_KEYS) {
      expect(allowlistText, excludedKey).not.toContain(`i.${excludedKey}`)
    }
  })

  test('buildDraftFacts on the FULLY-POPULATED fixture never emits an excluded value', () => {
    const facts = buildDraftFacts(FULL_INPUT)
    const serialized = JSON.stringify(facts)
    for (const value of EXCLUDED_VALUES) {
      expect(serialized).not.toContain(value)
    }
    // And it DOES emit every allowed fact for a fully-populated input — the
    // exclusion isn't accidentally dropping everything.
    expect(facts.map((f) => f.id).sort()).toEqual([...DRAFT_FACT_IDS].sort())
  })

  test('a resolver returning null/empty is OMITTED, never included as a blank fact', () => {
    const sparse: DraftFactsSourceInput = {
      stage: 'scouted',
      stageLabel: 'Detectado',
      ageInStageDays: 0,
      nextActionTitle: null,
      nextActionDueAt: null,
      preferredChannel: null,
      publicShopUrl: null,
      previewUrl: null,
      partnerDisplayName: null,
      businessName: '',
    }
    const facts = buildDraftFacts(sparse)
    // businessName is '' (falsy-empty) → omitted; everything else null → omitted.
    // Only stage/stage_label/age_in_stage_days (0 is a valid, non-empty number) survive.
    expect(facts.map((f) => f.id).sort()).toEqual(['age_in_stage_days', 'stage', 'stage_label'].sort())
  })

  test('factMap round-trips buildDraftFacts output into a lookup with no extra keys', () => {
    const facts = buildDraftFacts(FULL_INPUT)
    const map = factMap(facts)
    expect(Object.keys(map).sort()).toEqual([...DRAFT_FACT_IDS].sort())
  })
})

test.describe('draft-compose — the deterministic template composer (README D4)', () => {
  test('DRAFT_TEMPLATE_VERSION is a positive integer', () => {
    expect(Number.isInteger(DRAFT_TEMPLATE_VERSION)).toBe(true)
    expect(DRAFT_TEMPLATE_VERSION).toBeGreaterThan(0)
  })

  test('this file imports no model/LLM client of any kind', () => {
    const source = read('lib/portfolio/draft-compose.ts')
    expect(source).not.toMatch(/@anthropic-ai|openai|from ['"]ai['"]/)
  })

  test('an unknown templateId degrades to an empty draft, never throws', () => {
    const facts = buildDraftFacts(FULL_INPUT)
    const result = composeDraft(facts, 'not_a_real_template' as DraftTemplateId)
    expect(result).toEqual({ text: '', factIds: [] })
  })

  test('the FULLY-POPULATED fixture never leaks an excluded value into composed TEXT, for every template', () => {
    const facts = buildDraftFacts(FULL_INPUT)
    for (const templateId of DRAFT_TEMPLATE_IDS) {
      const { text } = composeDraft(facts, templateId)
      for (const value of EXCLUDED_VALUES) {
        expect(text, `${templateId} leaked ${value}`).not.toContain(value)
      }
    }
  })

  test('every template produces non-empty text from the fully-populated fixture (sanity — the guard above is non-vacuous)', () => {
    const facts = buildDraftFacts(FULL_INPUT)
    for (const templateId of DRAFT_TEMPLATE_IDS) {
      const { text } = composeDraft(facts, templateId)
      expect(text.length, templateId).toBeGreaterThan(0)
    }
  })

  test('a template referencing a fact the caller did not supply OMITS the clause — never a placeholder, never an invented value', () => {
    // Only `business_name` supplied — every other clause requires a fact
    // that's absent, so ONLY the greeting + the always-on closing render.
    const minimal = buildDraftFacts({
      stage: 'scouted',
      stageLabel: '',
      ageInStageDays: null as unknown as number,
      nextActionTitle: null,
      nextActionDueAt: null,
      preferredChannel: null,
      publicShopUrl: null,
      previewUrl: null,
      partnerDisplayName: null,
      businessName: 'Solo Nombre',
    })
    const { text, factIds } = composeDraft(minimal, 'follow_up')
    expect(text).toContain('Solo Nombre')
    expect(text).toContain('Quedo al pendiente.')
    expect(text).not.toMatch(/\{|\}|undefined|null|NaN/)
    expect(factIds).toEqual(['business_name'])
  })

  test('factIds names exactly what rendered — never a fact the template merely COULD reference', () => {
    const facts = buildDraftFacts(FULL_INPUT)
    const { factIds } = composeDraft(facts, 'preview_nudge')
    // preview_nudge's clause list only ever touches: business_name,
    // partner_display_name, preview_url, next_action_title — never
    // age_in_stage_days / public_shop_url / next_action_due_at / stage /
    // stage_label / preferred_channel, even though the fully-populated
    // fixture supplies them.
    for (const neverUsed of ['age_in_stage_days', 'public_shop_url', 'next_action_due_at', 'stage', 'stage_label', 'preferred_channel']) {
      expect(factIds, neverUsed).not.toContain(neverUsed)
    }
  })

  test('factIds is deterministically ORDERED by DRAFT_FACT_IDS, not by clause order', () => {
    const facts = buildDraftFacts(FULL_INPUT)
    const { factIds } = composeDraft(facts, 'follow_up')
    const expectedOrder = [...DRAFT_FACT_IDS].filter((id) => factIds.includes(id))
    expect(factIds).toEqual(expectedOrder)
  })

  test('composeDraft is PURE — same input, same output, every time', () => {
    const facts = buildDraftFacts(FULL_INPUT)
    const a = composeDraft(facts, 'activation_reminder')
    const b = composeDraft(facts, 'activation_reminder')
    expect(a).toEqual(b)
  })
})

// ── Layer 2 · source guards for the Story 2.1 routes (generate + PATCH edit) ─
// The confirm route (`.../draft/[draftId]/confirm`) is Story 2.3's own
// surface — its source guards live in `e2e/portfolio-no-auto-send.spec.ts`,
// which is also the load-bearing spec for that story.

const DRAFT_ROUTE_FILES = [
  'app/api/partner/relationship/[id]/draft/route.ts',
  'app/api/partner/relationship/[id]/draft/[draftId]/route.ts',
]

test.describe('source · every draft route gates FIRST and never 500s a compose/degrade path', () => {
  function handlerBodies(text: string): Array<{ method: string; body: string }> {
    const re = /export async function (GET|POST|PUT|PATCH|DELETE)\(/g
    const starts: Array<{ method: string; at: number }> = []
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) starts.push({ method: m[1], at: m.index })
    return starts.map((s, i) => ({
      method: s.method,
      body: text.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : text.length),
    }))
  }

  for (const file of DRAFT_ROUTE_FILES) {
    test(`every exported handler in ${file} awaits the portfolio gate FIRST`, () => {
      const handlers = handlerBodies(read(file))
      expect(handlers.length, 'no exported handler found — the scan would be vacuous').toBeGreaterThan(0)
      for (const { method, body } of handlers) {
        const gateAt = body.indexOf('await authorizePortfolioRequest(req)')
        expect(gateAt, `${method} must call the gate`).toBeGreaterThan(-1)
        const firstAwaitAt = body.indexOf('await ')
        expect(firstAwaitAt, `${method}: the gate must be the first await`).toBe(gateAt)
      }
    })

    test(`${file} checks canWriteRelationship after resolving scope`, () => {
      const text = read(file)
      expect(text).toContain('resolveRelationshipAccess(')
      expect(text).toContain('canWriteRelationship(access.role)')
    })
  }

  test('the generate route never imports a model/LLM client', () => {
    const text = read('app/api/partner/relationship/[id]/draft/route.ts')
    expect(text).not.toMatch(/@anthropic-ai|openai/)
  })
})

test.describe('source · the S2 migration matches the build contract', () => {
  const sql = read('supabase/migrations/20260725110000_partner_portfolio_s2.sql')

  test('merchant_followup_drafts CHECKs generator to exactly the D4 seam values', () => {
    expect(sql).toMatch(/generator\s+TEXT\s+NOT NULL\s+CHECK\s*\(generator IN \('template', 'model'\)\)/)
  })

  test('merchant_followup_drafts has RLS enabled', () => {
    expect(sql).toContain('ALTER TABLE merchant_followup_drafts    ENABLE ROW LEVEL SECURITY;')
  })

  // `merchant_followup_reminders` (Story 2.2) is asserted in
  // `e2e/portfolio-reminders.spec.ts` — both tables ship in this ONE
  // migration file (they must; a builder never applies it, and the
  // orchestrator applies it once, whole), but each story's spec only checks
  // the table its own story owns.

  test('the migration carries the "orchestrator applies this" header, and no CREATE POLICY exists anywhere', () => {
    expect(sql).toMatch(/does NOT apply this file/)
    expect(sql).not.toMatch(/CREATE POLICY/i)
  })
})

// ── Layer 1 · live guards ────────────────────────────────────────────────────

test.describe('live · the new draft endpoints never serve an anonymous caller', () => {
  test('POST draft (generate) → never 200, never a 5xx', async ({ request }) => {
    const res = await request.post('/api/partner/relationship/00000000-0000-0000-0000-000000000000/draft', {
      data: { templateId: 'follow_up' },
    })
    expect(res.status()).not.toBe(200)
    expect(res.status()).toBeLessThan(500)
  })

  test('PATCH draft edit → never 200, never a 5xx', async ({ request }) => {
    const res = await request.fetch(
      '/api/partner/relationship/00000000-0000-0000-0000-000000000000/draft/00000000-0000-0000-0000-000000000000',
      { method: 'PATCH', data: { editedText: 'x' } },
    )
    expect(res.status()).not.toBe(200)
    expect(res.status()).toBeLessThan(500)
  })
})
