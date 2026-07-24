/**
 * lib/scorecard/dictionary.ts
 *
 * Merchant activation scorecard · Sprint 1, Story 1.1 — the versioned metric
 * dictionary (README "Build-time architecture decisions", SD3/SD4). Every
 * metric the scorecard renders (UI, CSV export, agent tool) has ONE
 * definition here, and every stage-shaped fact it derives from IMPORTS the
 * canonical stage contract rather than restating it.
 *
 * ZERO-IMPORT beyond `lib/merchant-stage.ts` (SD3), which is itself
 * zero-import (no `server-only`, no Next, no Clerk) — so this file, and any
 * spec that imports it, loads in the Playwright `api` project with no
 * database, no Clerk, no webpack `react-server` build.
 *
 * DELIBERATE DEVIATION, flagged (not silently resolved): SD3's prose also
 * names `lib/merchant-medusa-reads.ts`'s `RETENTION_WINDOW_DAYS` and
 * `THREE_PRODUCTS_THRESHOLD` as imports this dictionary should carry. That
 * file itself does `import 'server-only'` (verified 2026-07-24) — the same
 * package `lib/merchant-commerce-facts.ts`'s own header documents as
 * "THROWS unconditionally outside a webpack `react-server` build", which is
 * exactly why `e2e/merchant-commerce-facts.spec.ts` does NOT import that
 * module directly either. Importing those two constants here would silently
 * break the "an `api` Playwright spec can load it" half of this story's own
 * acceptance. This file follows the SAME precedent
 * `lib/merchant-lifecycle.ts#deriveSaleFacts` already set for the identical
 * problem: the zero-import module takes the threshold as a PARAMETER
 * (`retentionWindowMs`), and only the impure caller
 * (`lib/merchant-lifecycle-sweep.ts`) imports the real constant. Here: the
 * impure loader (`lib/scorecard/loader.ts`, Story 1.2 — already `server-only`
 * because it touches Supabase/Medusa) is the ONLY module that imports
 * `RETENTION_WINDOW_DAYS`/`THREE_PRODUCTS_THRESHOLD`, and threads them into
 * the resolver as `ScorecardThresholds` (`lib/scorecard/resolver.ts`) so the
 * real numbers appear in the OUTPUT (for the retention/three-products metric
 * labels) without ever being re-typed as a literal in a pure module.
 * `e2e/scorecard-dictionary.spec.ts` enforces the no-restatement half of SD3
 * with a source-text guard (this file's own source text contains no bare
 * `30` or `3` day/threshold literal), mirroring the exact population-guard
 * technique `lib/merchant-commerce-facts.ts`'s header already cites
 * (Roadmap/LEARNINGS.md "guard the population, not the door you found").
 */
import { STAGES, STAGE_ORDINAL, type Stage } from '@/lib/merchant-stage'

/** Bump on any change to a metric's definition, computation or output shape —
 *  UI, CSV and the agent tool all echo this so a stale client can tell its
 *  cached shape apart from a changed one (decision 2: one resolver, one
 *  schema version). */
export const SCORECARD_SCHEMA_VERSION = 1

/** Every "day" boundary (age-in-stage, activation time, retention window) is
 *  computed and labeled against this timezone — Mexico City, no DST
 *  (mirrors `lib/relationship-pipeline.ts#dueAtIsoFromDateOnly`'s existing
 *  fixed-UTC-6 simplification, already relied upon elsewhere in this repo). */
export const SCORECARD_TIMEZONE = 'America/Mexico_City'

/**
 * The single stage this dictionary treats as "activated" for the
 * activation-time metric. A genuine MEMBER of `STAGES` (never a parallel
 * value) — `e2e/scorecard-dictionary.spec.ts` asserts
 * `STAGES.includes(ACTIVATION_STAGE)` directly, so a future stage-list edit
 * that drops this value fails loudly here rather than silently degrading
 * every activation-time read to "missing".
 */
export const ACTIVATION_STAGE: Stage = 'claimed'

/**
 * SD4 — a metric never substitutes 0 for "we don't know". `value` is `null`
 * whenever `health !== 'ok'`; a genuine zero is always `{ value: 0, health:
 * 'ok' }` and nothing else ever produces that exact shape.
 *
 *   - `ok`      — a real, fully-computed value. May legitimately be 0.
 *   - `stale`   — a value exists but is known-degraded (partial coverage, an
 *                 unreachable read for PART of the population, or a Golden
 *                 Beans mirror behind the canonical source). May carry a
 *                 best-effort `value`, or `null` if no best effort exists.
 *   - `missing` — no data exists at all (upstream read failed outright, zero
 *                 data points, or a `0`-denominator ratio). `value` is
 *                 always `null`.
 */
export type MetricHealth = 'ok' | 'stale' | 'missing'

export interface MetricValue<T> {
  value: T | null
  health: MetricHealth
  /** Which read this value traces back to — echoed verbatim in the UI/CSV/
   *  agent output so "where did this number come from" never needs a second
   *  lookup. */
  source: string
  /** ISO instant this value was computed. */
  asOf: string
}

export function okMetric<T>(value: T, source: string, asOf: string): MetricValue<T> {
  return { value, health: 'ok', source, asOf }
}

export function missingMetric<T>(source: string, asOf: string): MetricValue<T> {
  return { value: null, health: 'missing', source, asOf }
}

export function staleMetric<T>(value: T | null, source: string, asOf: string): MetricValue<T> {
  return { value, health: 'stale', source, asOf }
}

export type MetricUnit = 'count' | 'ratio' | 'days'

export interface MetricDefinition {
  id: string
  label: string
  description: string
  unit: MetricUnit
  source: string
  /** Rows/records EXCLUDED from this metric's population, and why — visible
   *  in the UI/CSV definitions panel so "why doesn't this add up to the
   *  cohort size" is answered by the dictionary, never left implicit. */
  exclusions: string
}

/**
 * One entry per metric family the scorecard renders. Funnel-shaped metrics
 * (`funnel_stage_count`, `funnel_stage_conversion`, `age_in_stage_*`) apply
 * once PER STAGE in `STAGES` order — this dictionary defines the metric
 * ONCE, not 13 times, because the definition (what it means, where it comes
 * from, what's excluded) is identical across stages; only the stage itself
 * varies, and that variable IS `STAGES`.
 */
export const METRIC_DICTIONARY: Readonly<Record<string, MetricDefinition>> = {
  cohort_entry: {
    id: 'cohort_entry',
    label: 'Tamaño del cohorte',
    description: 'Relaciones de comercio fundador que coinciden con los filtros activos (cohorte, etapa, promotor/dueño, rango de fecha de alta).',
    unit: 'count',
    source: 'merchant_relationships',
    exclusions: 'Ninguna en esta versión — cuenta cada fila que pasa los filtros, sin importar su etapa.',
  },
  funnel_stage_count: {
    id: 'funnel_stage_count',
    label: 'Comercios que alcanzaron la etapa (o una posterior)',
    description:
      'Para cada una de las 13 etapas canónicas, el número de relaciones del cohorte cuya etapa actual tiene un ordinal igual o mayor — "alcanzó esta etapa, o siguió avanzando".',
    unit: 'count',
    source: 'merchant_relationships.stage',
    exclusions: 'Una fila cuya etapa no es una de las 13 reconocidas se excluye del embudo (defensivo; el CHECK de la base de datos ya lo impide en la práctica).',
  },
  funnel_stage_conversion: {
    id: 'funnel_stage_conversion',
    label: 'Conversión desde la etapa anterior',
    description: 'La razón entre el conteo de esta etapa y el de la etapa inmediatamente anterior en STAGES.',
    unit: 'ratio',
    source: 'funnel_stage_count',
    exclusions: 'La etapa base (scouted) no tiene "anterior" — su conversión es "missing" por definición. Si la etapa anterior tiene 0 comercios, la razón es "missing" (sin denominador), nunca 0.',
  },
  age_in_stage_median_days: {
    id: 'age_in_stage_median_days',
    label: 'Días en la etapa (mediana)',
    description:
      'Mediana de días que los comercios pasaron en cada etapa: intervalos CERRADOS derivados de merchant_relationship_transitions para etapas ya superadas, más un intervalo ABIERTO (hoy − fecha de entrada) para el comercio que está actualmente ahí.',
    unit: 'days',
    source: 'merchant_relationship_transitions + merchant_relationships.stage_entered_at',
    exclusions: 'Una etapa sin ningún intervalo (ni cerrado ni abierto) reporta "missing", nunca 0 días.',
  },
  age_in_stage_p90_days: {
    id: 'age_in_stage_p90_days',
    label: 'Días en la etapa (percentil 90)',
    description: 'Igual que la mediana, pero el percentil 90 de la misma distribución.',
    unit: 'days',
    source: 'merchant_relationship_transitions + merchant_relationships.stage_entered_at',
    exclusions: 'Mismas exclusiones que age_in_stage_median_days.',
  },
  overdue_count: {
    id: 'overdue_count',
    label: 'Próxima acción vencida',
    description: 'Comercios del cohorte cuya próxima acción con fecha ya pasó (lib/relationship-pipeline.ts#isOverdue).',
    unit: 'count',
    source: 'relationship-enrich.overdue',
    exclusions: 'Ninguna — cuenta sobre el cohorte filtrado completo.',
  },
  missing_action_count: {
    id: 'missing_action_count',
    label: 'Sin próxima acción con fecha',
    description: 'Comercios del cohorte sin ninguna tarea abierta con fecha (lib/relationship-pipeline.ts#isMissingAction).',
    unit: 'count',
    source: 'relationship-enrich.missingAction',
    exclusions: 'Una tarea abierta SIN fecha no cuenta como "próxima acción" — sigue contando como faltante, igual que en /admin/relaciones.',
  },
  activation_time_median_days: {
    id: 'activation_time_median_days',
    label: 'Tiempo hasta activación (mediana)',
    description: `Días desde el alta de la relación (created_at) hasta la transición registrada hacia la etapa "${ACTIVATION_STAGE}", para cada comercio que la alcanzó.`,
    unit: 'days',
    source: 'merchant_relationship_transitions',
    exclusions:
      'Un comercio cuya etapa actual ya alcanzó o superó la etapa de activación pero SIN una fila de transición correspondiente se excluye del cálculo (no se estima) y degrada la métrica a "stale", nunca a 0.',
  },
  activation_time_p90_days: {
    id: 'activation_time_p90_days',
    label: 'Tiempo hasta activación (percentil 90)',
    description: 'Igual que la mediana, percentil 90 de la misma distribución.',
    unit: 'days',
    source: 'merchant_relationship_transitions',
    exclusions: 'Mismas exclusiones que activation_time_median_days.',
  },
  first_sale_count: {
    id: 'first_sale_count',
    label: 'Con primera venta',
    description: 'Comercios con tienda vinculada (shop_id) cuyo primer hecho comercial de venta es verdadero (lib/merchant-commerce-facts.ts vía la reconciliación).',
    unit: 'count',
    source: 'loadCommerceFacts.firstSale',
    exclusions: 'Un comercio sin tienda vinculada se excluye de la población elegible por completo (no hay hecho comercial que leer).',
  },
  first_sale_rate: {
    id: 'first_sale_rate',
    label: 'Tasa de primera venta',
    description: 'first_sale_count dividido entre los comercios elegibles cuyo hecho comercial se pudo leer con éxito.',
    unit: 'ratio',
    source: 'loadCommerceFacts.firstSale',
    exclusions: 'Igual que first_sale_count, más: un comercio cuya lectura de hechos comerciales falló se excluye del denominador (nunca se cuenta como "sin venta").',
  },
  retained_30d_count: {
    id: 'retained_30d_count',
    label: 'Retenido a la ventana de retención',
    description: 'Comercios con tienda vinculada cuyo hecho "retenido" es verdadero — sigue vendiendo pasada la ventana de retención configurada.',
    unit: 'count',
    source: 'loadCommerceFacts.retained30d',
    exclusions: 'Igual que first_sale_count. La longitud exacta de la ventana (días) viene de RETENTION_WINDOW_DAYS, leída por el cargador (Story 1.2), nunca hardcodeada aquí.',
  },
  retained_30d_rate: {
    id: 'retained_30d_rate',
    label: 'Tasa de retención',
    description: 'retained_30d_count dividido entre los comercios elegibles cuyo hecho comercial se pudo leer con éxito.',
    unit: 'ratio',
    source: 'loadCommerceFacts.retained30d',
    exclusions: 'Igual que first_sale_rate.',
  },
  freshness: {
    id: 'freshness',
    label: 'Frescura de la proyección (Golden Beans)',
    description:
      'Diagnóstico, no una métrica de negocio (SD1): para cada comercio que alcanzó una etapa con hito, ¿existe una emisión ENTREGADA hacia Golden Beans para esa etapa? Un hito alcanzado sin emisión entregada marca el comercio como "stale" aquí — el resto de la tarjeta sigue leyendo de las tablas canónicas de Miyagi, nunca de Golden Beans.',
    unit: 'count',
    source: 'relationship-reconciliation (merchant_lifecycle_emissions)',
    exclusions: 'La etapa base (scouted) nunca se revisa — no tiene hito que emitir.',
  },
}

// ── SD3 — re-exported BY REFERENCE, never redefined. `e2e/scorecard-
// dictionary.spec.ts` asserts `DICTIONARY_STAGES` deep-equals `[...STAGES]`
// and `DICTIONARY_STAGE_ORDINAL === STAGE_ORDINAL` (reference equality —
// only true if this is a genuine re-export, not a parallel copy). ─────────
export const DICTIONARY_STAGES: readonly Stage[] = STAGES
export const DICTIONARY_STAGE_ORDINAL: Readonly<Record<Stage, number>> = STAGE_ORDINAL
export type { Stage }
