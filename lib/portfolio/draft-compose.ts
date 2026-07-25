/**
 * lib/portfolio/draft-compose.ts
 *
 * Merchant Partner lifecycle · Sprint 2, Story 2.1 — the deterministic
 * versioned TEMPLATE COMPOSER (README D4). This repo has no LLM client, no
 * model dependency and no API key anywhere — verified live — and Daniel chose
 * this explicitly over provisioning one for a pre-launch surface with zero
 * merchants. `composeDraft` is a PURE function: same facts + same template id
 * → same text, always. Do not add a model call here.
 *
 * ZERO-IMPORT (build contract), beyond the zero-import `draft-facts.ts`
 * sibling — no `server-only`, no `next/*`, no Clerk, no Supabase.
 *
 * "UNSUPPORTED CLAIMS ARE EXCLUDED" IS A COMPOSE-TIME GUARANTEE. Each
 * template is an ordered list of CLAUSES; a clause names the exact fact ids
 * its own sentence references (`requires`), and renders ONLY when every one
 * of those ids is present in the supplied fact map. A clause never falls back
 * to inventing a value or emitting a blank placeholder for a missing fact —
 * it is skipped outright. `factIds` in the result is the union of every
 * RENDERED clause's `requires`, so it always names exactly what the returned
 * text actually used, never what the template merely COULD have used.
 */
import { DRAFT_FACT_IDS, factMap, type DraftFact, type DraftFactId, type DraftFactValue } from '@/lib/portfolio/draft-facts'

/** Bump on ANY copy change to a clause or a template's clause order — every
 *  stored draft echoes this so a provenance panel can always name the exact
 *  wording generator that produced it. Same discipline as
 *  `lib/portfolio/sla.ts#SLA_POLICY_VERSION`. */
export const DRAFT_TEMPLATE_VERSION = 1

export type DraftTemplateId = 'follow_up' | 'preview_nudge' | 'activation_reminder' | 'retention_checkin'

export const DRAFT_TEMPLATE_IDS: readonly DraftTemplateId[] = [
  'follow_up',
  'preview_nudge',
  'activation_reminder',
  'retention_checkin',
]

type FactMap = Partial<Record<DraftFactId, DraftFactValue>>

interface Clause {
  /** Every fact id this clause's sentence references. ALL must be present in
   *  the fact map for the clause to render — a partial match still omits it,
   *  because a sentence that references two facts and only has one of them
   *  would otherwise render with a hole in it. */
  requires: readonly DraftFactId[]
  render: (facts: FactMap) => string
}

// ── The clause library — one sentence, one purpose, no overlap ─────────────
// Every clause's rendered text references ONLY the fact ids in its own
// `requires` — never a fact from outside that list, and never two clauses
// asserting the same fact in a way that could double up in one draft.

const CLAUSE = {
  greeting: {
    requires: ['business_name'],
    render: (f) => `Hola, equipo de ${f.business_name as string}.`,
  } satisfies Clause,

  introducedBy: {
    requires: ['partner_display_name'],
    render: (f) => `Soy ${f.partner_display_name as string}, tu Aliado en Miyagi Sánchez.`,
  } satisfies Clause,

  stageNote: {
    requires: ['stage_label'],
    render: (f) => `Vi que tu negocio está en la etapa de "${f.stage_label as string}".`,
  } satisfies Clause,

  ageNote: {
    requires: ['age_in_stage_days'],
    render: (f) => `Llevas ${f.age_in_stage_days as number} día(s) en esta etapa y quiero ayudarte a avanzar.`,
  } satisfies Clause,

  nextAction: {
    requires: ['next_action_title'],
    render: (f) => `Tu próxima acción pendiente: ${f.next_action_title as string}.`,
  } satisfies Clause,

  nextActionDue: {
    requires: ['next_action_due_at'],
    render: (f) => `La fecha compromiso es ${f.next_action_due_at as string}.`,
  } satisfies Clause,

  channelNote: {
    requires: ['preferred_channel'],
    render: (f) => `Te escribo por ${f.preferred_channel as string}, tu canal preferido.`,
  } satisfies Clause,

  shopLink: {
    requires: ['public_shop_url'],
    render: (f) => `Así se ve tu tienda ahora mismo: ${f.public_shop_url as string}`,
  } satisfies Clause,

  previewLink: {
    requires: ['preview_url'],
    render: (f) => `Aquí puedes revisar tu vista previa: ${f.preview_url as string}`,
  } satisfies Clause,

  /** No `requires` — always renders, so every draft ends with at least one
   *  closing line even when every other fact was absent. */
  closing: {
    requires: [],
    render: () => 'Quedo al pendiente.',
  } satisfies Clause,
} as const

/** Ordered clause lists per intent — the ONLY place template wording is
 *  defined. es-MX only (AGENTS rule #5). */
const TEMPLATES: Readonly<Record<DraftTemplateId, readonly Clause[]>> = {
  follow_up: [
    CLAUSE.greeting,
    CLAUSE.introducedBy,
    CLAUSE.stageNote,
    CLAUSE.ageNote,
    CLAUSE.nextAction,
    CLAUSE.nextActionDue,
    CLAUSE.channelNote,
    CLAUSE.closing,
  ],
  preview_nudge: [CLAUSE.greeting, CLAUSE.introducedBy, CLAUSE.previewLink, CLAUSE.nextAction, CLAUSE.closing],
  activation_reminder: [
    CLAUSE.greeting,
    CLAUSE.introducedBy,
    CLAUSE.stageNote,
    CLAUSE.shopLink,
    CLAUSE.nextAction,
    CLAUSE.nextActionDue,
    CLAUSE.closing,
  ],
  retention_checkin: [CLAUSE.greeting, CLAUSE.introducedBy, CLAUSE.ageNote, CLAUSE.shopLink, CLAUSE.channelNote, CLAUSE.closing],
}

export interface ComposeDraftResult {
  text: string
  /** The DEDUPED, DETERMINISTICALLY-ORDERED (by `DRAFT_FACT_IDS`) union of
   *  every rendered clause's `requires` — exactly what the returned text used,
   *  never what the template could have used. */
  factIds: DraftFactId[]
}

/**
 * Pure composition. An unknown `templateId` never throws — it degrades to an
 * empty draft (`{ text: '', factIds: [] }`), which is exactly the
 * degraded-but-usable shape the generate route falls back to on any failure
 * (build contract: "failures leave manual composition available").
 */
export function composeDraft(facts: readonly DraftFact[], templateId: DraftTemplateId): ComposeDraftResult {
  const clauses = TEMPLATES[templateId]
  if (!clauses) return { text: '', factIds: [] }

  const map = factMap(facts)
  const usedIds = new Set<DraftFactId>()
  const lines: string[] = []

  for (const clause of clauses) {
    if (!clause.requires.every((id) => map[id] !== undefined)) continue
    lines.push(clause.render(map))
    for (const id of clause.requires) usedIds.add(id)
  }

  return {
    text: lines.join('\n\n'),
    factIds: DRAFT_FACT_IDS.filter((id) => usedIds.has(id)),
  }
}
