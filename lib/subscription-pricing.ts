/**
 * lib/subscription-pricing.ts
 *
 * PDP redesign (epic 01) — Sprint 4, S4.4 (subscriptions).
 *
 * Pure, next-free seam for the mensual/anual toggle + the annual-saving figure.
 * Tiers are stored flat, each carrying its own `interval` ('month'|'year'); this
 * module pairs same-plan month/year tiers so the PDP can offer a toggle and show
 * the EXACT saving (`12 × mensual − anual`). No JSX / no network / no `next/*` →
 * unit-testable in the `api` gate (`e2e/subscription-pricing.spec.ts`). The saving
 * must be exact, so the math lives here as the single source for UI + spec.
 */

export interface PlanTier {
  id: string
  label: string
  price_cents: number
  interval: 'month' | 'year'
  is_highlighted: boolean
}

export interface AnnualSaving {
  /** 12 × monthly − annual, in cents (always > 0 — null otherwise). */
  savingCents: number
  /** Rounded percentage off the pay-monthly-for-a-year cost. */
  savingPct: number
  monthlyCents: number
  annualCents: number
}

/**
 * The exact saving of paying annually vs. 12× the monthly rate. Returns null when
 * either price is missing/non-positive or the annual plan isn't actually cheaper.
 */
export function annualSaving(monthlyCents: number, annualCents: number): AnnualSaving | null {
  if (!(monthlyCents > 0) || !(annualCents > 0)) return null
  const yearAtMonthly = monthlyCents * 12
  const savingCents = yearAtMonthly - annualCents
  if (savingCents <= 0) return null
  return {
    savingCents,
    savingPct: Math.round((savingCents / yearAtMonthly) * 100),
    monthlyCents,
    annualCents,
  }
}

// Interval words stripped to derive a plan key from a tier label, so "Pro Mensual"
// and "Pro Anual" group into one plan.
const INTERVAL_WORDS = /\b(mensual(es)?|anual(es)?|al\s+a[nñ]o|al\s+mes|por\s+mes|por\s+a[nñ]o|monthly|yearly|annual)\b/gi

/** Normalised plan key from a tier label (interval words + punctuation removed). */
export function planKey(label: string): string {
  return label.toLowerCase().replace(INTERVAL_WORDS, '').replace(/[^a-z0-9áéíóúñ]+/gi, ' ').trim()
}

export interface PlanGroup<T extends PlanTier = PlanTier> {
  key: string
  /** Display label with the interval word stripped (falls back to the raw label). */
  label: string
  monthly: T | null
  annual: T | null
  is_highlighted: boolean
}

/** Are both a monthly and an annual tier present anywhere in the set? */
export function hasBothIntervals(tiers: PlanTier[]): boolean {
  return tiers.some(t => t.interval === 'month') && tiers.some(t => t.interval === 'year')
}

/** Pair month/year tiers of the same plan, preserving first-seen order. */
export function groupTiersByPlan<T extends PlanTier>(tiers: T[]): PlanGroup<T>[] {
  const map = new Map<string, PlanGroup<T>>()
  const order: string[] = []
  for (const t of tiers) {
    const key = planKey(t.label) || t.id
    let g = map.get(key)
    if (!g) {
      g = { key, label: t.label.replace(INTERVAL_WORDS, '').trim() || t.label, monthly: null, annual: null, is_highlighted: false }
      map.set(key, g)
      order.push(key)
    }
    if (t.interval === 'year') g.annual = t
    else g.monthly = t
    if (t.is_highlighted) g.is_highlighted = true
  }
  return order.map(k => map.get(k)!)
}

/** The annual saving for the plan a given tier belongs to, or null. */
export function tierAnnualSaving<T extends PlanTier>(groups: PlanGroup<T>[], tierId: string): AnnualSaving | null {
  const g = groups.find(g => g.monthly?.id === tierId || g.annual?.id === tierId)
  if (!g || !g.monthly || !g.annual) return null
  return annualSaving(g.monthly.price_cents, g.annual.price_cents)
}
