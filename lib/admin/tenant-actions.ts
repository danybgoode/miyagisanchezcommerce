/**
 * lib/admin/tenant-actions.ts
 *
 * The PURE decision for every tenant mutation (tenant-lifecycle-admin · D3, D7).
 *
 * ── VALIDATE BEFORE YOU WRITE ─────────────────────────────────────────────────
 * Every field is parsed and every rule is decided here, before the route touches
 * Medusa or Supabase. The owned-shop epic shipped a defect where publication
 * validation ran AFTER the title and image writes, so a rejected request persisted
 * half of itself and still returned an error — and asserting the status code alone
 * would not have caught it, because the broken code returned the right code too.
 * Deciding first makes a partial apply structurally impossible rather than merely
 * unlikely, and the spec asserts the ORDERING via the fact that this function is
 * total and side-effect-free.
 *
 * ── EDITS REJECT, THEY DO NOT COERCE ──────────────────────────────────────────
 * A blank name, an over-long description, a slug with a space: all refused with a
 * message naming the field. `LEARNINGS.md`: coerce a purchase, reject a mutation. An
 * admin who typo'd a slug must be told, not quietly given a different slug.
 *
 * Pure: no `server-only`, no I/O.
 */
import { SELLER_STATUSES, type SellerStatus } from '@/lib/seller-status'

/** What an operator can change about a shop's presentation. */
export type TenantEditPatch = {
  name?: string
  description?: string | null
  location?: string | null
}

export const TENANT_EDITABLE_FIELDS = ['name', 'description', 'location'] as const

/**
 * Deliberately NOT editable here: `slug` and `custom_domain`.
 *
 * A slug is the shop's public URL and its subdomain — changing it breaks every link
 * anyone has shared, every QR code printed on a card, and the shop's own
 * `slug.miyagisanchez.com`. A custom domain has its own provisioning and verification
 * flow that this route would bypass. Both are real operations that deserve their own
 * deliberate surface, not a text field in a directory row.
 */
export const TENANT_NON_EDITABLE_FIELDS = ['slug', 'custom_domain'] as const

const MAX_NAME = 120
const MAX_DESCRIPTION = 2_000
const MAX_LOCATION = 160
const MAX_REASON = 500

export type ActionRefusal = { ok: false; status: 400; field: string; message: string }

export type EditDecision = { ok: true; patch: TenantEditPatch } | ActionRefusal

function refuse(field: string, message: string): ActionRefusal {
  return { ok: false, status: 400, field, message }
}

/**
 * Parse an edit request.
 *
 * An absent key means "leave it alone"; an explicit `null` on a nullable field means
 * "clear it". Those are different intents and conflating them would make it
 * impossible to clear a description at all.
 */
export function decideTenantEdit(body: unknown): EditDecision {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return refuse('body', 'Datos inválidos.')
  }
  const input = body as Record<string, unknown>

  for (const field of TENANT_NON_EDITABLE_FIELDS) {
    if (input[field] !== undefined) {
      return refuse(
        field,
        field === 'slug'
          ? 'El slug no se edita aquí: cambiarlo rompe cada enlace compartido y el subdominio de la tienda.'
          : 'El dominio propio se gestiona en su propio flujo de verificación.',
      )
    }
  }

  const patch: TenantEditPatch = {}

  if (input.name !== undefined) {
    if (typeof input.name !== 'string') return refuse('name', 'El nombre debe ser texto.')
    const name = input.name.trim()
    if (!name) return refuse('name', 'El nombre no puede quedar vacío.')
    if (name.length > MAX_NAME) return refuse('name', `El nombre no puede pasar de ${MAX_NAME} caracteres.`)
    patch.name = name
  }

  if (input.description !== undefined) {
    if (input.description === null) patch.description = null
    else if (typeof input.description !== 'string') return refuse('description', 'La descripción debe ser texto.')
    else {
      const description = input.description.trim()
      if (description.length > MAX_DESCRIPTION) {
        return refuse('description', `La descripción no puede pasar de ${MAX_DESCRIPTION} caracteres.`)
      }
      patch.description = description || null
    }
  }

  if (input.location !== undefined) {
    if (input.location === null) patch.location = null
    else if (typeof input.location !== 'string') return refuse('location', 'La ubicación debe ser texto.')
    else {
      const location = input.location.trim()
      if (location.length > MAX_LOCATION) {
        return refuse('location', `La ubicación no puede pasar de ${MAX_LOCATION} caracteres.`)
      }
      patch.location = location || null
    }
  }

  if (Object.keys(patch).length === 0) {
    // A no-op edit reports as one rather than being applied and audited as a change.
    return refuse('body', 'No hay nada que cambiar.')
  }
  return { ok: true, patch }
}

export type StatusDecision =
  | { ok: true; status: SellerStatus; reason: string }
  | ActionRefusal

/**
 * Parse a status change.
 *
 * A REASON IS REQUIRED, and that is not ceremony: the audit row is the only record of
 * why a shop went dark, and "paused by admin" with no cause is what makes an incident
 * six months later unresolvable. The backend is the authority on whether the
 * transition is legal (deleted is terminal, no-ops are refused) — this only proves the
 * request is well-formed, so the two never restate each other's rules.
 */
export function decideStatusChange(body: unknown): StatusDecision {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return refuse('body', 'Datos inválidos.')
  }
  const input = body as Record<string, unknown>

  if (typeof input.status !== 'string' || !(SELLER_STATUSES as readonly string[]).includes(input.status)) {
    return refuse('status', `El estado debe ser uno de: ${SELLER_STATUSES.join(', ')}.`)
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (!reason) return refuse('reason', 'Escribe por qué haces este cambio (queda en la auditoría).')
  if (reason.length > MAX_REASON) return refuse('reason', `El motivo no puede pasar de ${MAX_REASON} caracteres.`)

  return { ok: true, status: input.status as SellerStatus, reason }
}

/**
 * Copy for the confirmation an operator sees before a status change lands.
 *
 * Named per transition rather than generic, because "¿Seguro?" tells nobody what is
 * about to happen. Pausing and deleting have genuinely different consequences and the
 * dialog should say which one it is about to do.
 */
export function statusChangeConfirmation(shopName: string, to: SellerStatus): string {
  switch (to) {
    case 'paused':
      return `Pausar “${shopName}”. Sus productos salen del catálogo y no podrá vender ni hacer cambios. `
        + 'Los pedidos existentes se conservan y puedes reactivarla después.'
    case 'deleted':
      return `Eliminar “${shopName}”. Sus productos salen del catálogo y la tienda deja de existir para los `
        + 'compradores. El historial de pedidos se conserva, pero esta acción no se revierte desde aquí.'
    case 'active':
    default:
      return `Reactivar “${shopName}”. Se restauran exactamente los productos que se retiraron al pausarla.`
  }
}
