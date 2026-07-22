/**
 * lib/preview-checklist.ts
 *
 * Founding merchant consent-safe previews · Sprint 3 — the preview-readiness
 * checklist: the one quality-and-consent standard every activation must meet.
 *
 * Deliberately ZERO app imports (no `server-only`, no Supabase, no `next/*`) so the
 * rule that BLOCKS a publication is directly unit-testable from a Playwright `api`
 * spec — same discipline as lib/preview-snapshot.ts. `lib/preview-consent.ts`
 * composes this with the DB reads and enforces it server-side inside
 * `checkActivation`, so the promoter workspace, the activation route and the specs
 * all read one rule.
 *
 * Required items block activation. Informational items (the derived "next action")
 * never block — they only tell the promoter what to do next.
 */

/** The facts an activation decision is allowed to depend on. All non-PII. */
export interface ChecklistFacts {
  /** Shop display name as it would be published. */
  shopName: string
  /** True when the shop carries structured location data (estado/municipio/CP). */
  hasLocation: boolean
  /** True when a merchant contact (email) is on file. Never the address itself. */
  hasMerchantContact: boolean
  /** The exact product set that would be published. */
  products: Array<{
    title: string
    priceCents: number | null
    imageUrl: string | null
  }>
  /** Preview lifecycle status ('draft' means the merchant has never opened it). */
  status: string
  /** True when an approval exists AND still matches what would be published. */
  currentApproval: boolean
  /** The promoter accountable for this preview (clerk id presence only, never the id). */
  hasSteward: boolean
}

export interface ChecklistItem {
  key: string
  /** es-MX label shown in the promoter workspace. */
  label: string
  /** Required items block activation; informational ones never do. */
  required: boolean
  done: boolean
  /** What the promoter must do when `done` is false. */
  action: string
}

/**
 * Build the readiness checklist. Pure and total — every item is decided from the
 * facts passed in, so the same inputs always yield the same checklist.
 */
export function buildChecklist(facts: ChecklistFacts): ChecklistItem[] {
  const products = facts.products ?? []
  const hasProducts = products.length > 0

  return [
    {
      key: 'merchant_identity',
      label: 'Identidad del negocio (nombre y ubicación)',
      required: true,
      done: (facts.shopName ?? '').trim().length >= 2 && facts.hasLocation === true,
      action: 'Completa el nombre y la ubicación del negocio en el paso 1.',
    },
    {
      key: 'merchant_contact',
      label: 'Contacto del comerciante verificado',
      required: true,
      done: facts.hasMerchantContact === true,
      action: 'Captura el correo del comerciante en el paso 1.',
    },
    {
      key: 'product_facts',
      label: 'Cada producto tiene un título claro',
      required: true,
      // An empty proposal fails here too: there is nothing to review or publish.
      done: hasProducts && products.every((p) => (p.title ?? '').trim().length >= 3),
      action: 'Revisa que cada producto tenga un título de al menos 3 caracteres.',
    },
    {
      key: 'prices',
      label: 'Cada producto tiene precio',
      required: true,
      done: hasProducts && products.every((p) => typeof p.priceCents === 'number' && p.priceCents > 0),
      action: 'Agrega el precio de cada producto antes de publicar.',
    },
    {
      key: 'asset_provenance',
      label: 'Cada producto tiene foto propia del negocio',
      required: true,
      // Provenance we can actually verify: a photo exists. A product published
      // with no image has nothing the merchant could have reviewed or consented to.
      done: hasProducts && products.every((p) => !!(p.imageUrl ?? '').trim()),
      action: 'Toma y sube una foto de cada producto en el negocio.',
    },
    {
      key: 'merchant_review',
      label: 'El comerciante abrió y revisó la propuesta',
      required: true,
      // 'draft' means the private link was never opened. Every later status
      // (delivered / changes_requested / approved / invalidated / activated)
      // proves the merchant reached the proposal at least once.
      done: facts.status !== 'draft',
      action: 'Comparte el enlace de vista previa y pide al comerciante que lo abra.',
    },
    {
      key: 'current_approval',
      label: 'Aprobación vigente del comerciante',
      required: true,
      done: facts.currentApproval === true,
      action: 'Pide la aprobación del comerciante sobre la versión actual.',
    },
    {
      key: 'steward',
      label: 'Promotor responsable asignado',
      required: true,
      done: facts.hasSteward === true,
      action: 'Esta vista previa no tiene promotor responsable. Avísale al equipo.',
    },
  ]
}

/** Are all REQUIRED items complete? This is what gates activation. */
export function checklistComplete(items: ChecklistItem[]): boolean {
  return (items ?? []).every((i) => !i.required || i.done)
}

/**
 * The single next action a promoter should take — the first incomplete required
 * item's action, or null when the checklist is complete. Derived (never stored),
 * so it can't drift from the items themselves.
 */
export function nextAction(items: ChecklistItem[]): string | null {
  const pending = (items ?? []).find((i) => i.required && !i.done)
  return pending ? pending.action : null
}
