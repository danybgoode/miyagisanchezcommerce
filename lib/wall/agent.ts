import 'server-only'

/**
 * Living Shop — the Wall's agent surface (epic 07, Story 6.3).
 *
 * The MCP tools' whole implementation, kept out of the 4,000-line MCP route so
 * it is reachable from a spec and so the route stays a dispatcher.
 *
 * 🚨 EPIC D12 — every write here calls the SAME `validateWallEntryCreate` /
 * `validateWallEntryUpdate` and the SAME `referenceBelongsToShop` the human HTTP
 * route calls. If an agent could reach a laxer path than a person, the schema
 * has forked and one of the two is wrong; sharing the functions is what makes
 * that impossible rather than merely discouraged.
 *
 * Media is a platform-issued URL or nothing — the validator's `isPlatformMediaUrl`
 * enforces `https`, and there is no remote-fetch path here. An agent cannot make
 * this server download an arbitrary URL by attaching it to a post.
 */

import { validateWallEntryCreate, validateWallEntryUpdate } from './validate'
import { referenceBelongsToShop } from './resolve'
import {
  listOwnWallEntries,
  getOwnWallEntry,
  createWallEntry,
  updateWallEntry,
  deleteWallEntry,
  type WallShop,
} from './store'
import type { WallEntry } from './types'

export type WallToolOutcome =
  | { ok: true; message: string; data: unknown }
  | { ok: false; message: string }

/** Compact, agent-readable projection. Never leaks another shop's anything. */
function toAgentView(entry: WallEntry) {
  return {
    id: entry.id,
    kind: entry.kind,
    status: entry.status,
    body: entry.body,
    media: entry.media,
    reference_id: entry.reference_id,
    published_at: entry.published_at,
    scheduled_for: entry.scheduled_for,
    pinned: entry.pinned,
  }
}

export async function agentListWall(shop: WallShop): Promise<WallToolOutcome> {
  const entries = await listOwnWallEntries(shop.id)
  return {
    ok: true,
    message: entries.length === 0
      ? 'El muro está vacío. Usa `create_wall_entry` para publicar la primera.'
      : `${entries.length} publicación(es) en el muro de ${shop.name}.`,
    data: { entries: entries.map(toAgentView) },
  }
}

export async function agentCreateWallEntry(
  shop: WallShop,
  clerkUserId: string,
  args: Record<string, unknown>,
): Promise<WallToolOutcome> {
  const validation = validateWallEntryCreate(args)
  if (!validation.ok) {
    return { ok: false, message: validation.issues.map((i) => `${i.field}: ${i.message}`).join('\n') }
  }
  // Ownership is a SEPARATE check from shape, and it names the same identifier
  // the public renderer will resolve. A validator that returned ok for a foreign
  // product id would be an admission proof that does not match what is consumed.
  const owns = await referenceBelongsToShop(validation.value.kind, validation.value.reference_id, shop)
  if (!owns) {
    return {
      ok: false,
      message: `El ${validation.value.kind} "${validation.value.reference_id}" no pertenece a la tienda ${shop.slug}. Solo puedes publicar objetos de tu propia tienda.`,
    }
  }
  const entry = await createWallEntry(shop, clerkUserId, validation.value)
  return { ok: true, message: `Publicación creada (${entry.status}).`, data: toAgentView(entry) }
}

export async function agentUpdateWallEntry(
  shop: WallShop,
  entryId: string,
  args: Record<string, unknown>,
): Promise<WallToolOutcome> {
  const existing = await getOwnWallEntry(shop.id, entryId)
  // Scoped read: a foreign id is simply absent, so the agent learns nothing
  // about whether it exists on some other shop.
  if (!existing) return { ok: false, message: `No existe una publicación con id ${entryId} en tu muro.` }

  const validation = validateWallEntryUpdate(existing, args)
  if (!validation.ok) {
    return { ok: false, message: validation.issues.map((i) => `${i.field}: ${i.message}`).join('\n') }
  }
  const owns = await referenceBelongsToShop(validation.value.kind, validation.value.reference_id, shop)
  if (!owns) {
    return { ok: false, message: `Esa referencia no pertenece a la tienda ${shop.slug}.` }
  }
  const outcome = await updateWallEntry(shop, existing, validation.value)
  if (!outcome.ok) return { ok: false, message: outcome.error }
  return { ok: true, message: `Publicación actualizada (${outcome.entry.status}).`, data: toAgentView(outcome.entry) }
}

export async function agentDeleteWallEntry(shop: WallShop, entryId: string): Promise<WallToolOutcome> {
  const removed = await deleteWallEntry(shop.id, entryId)
  if (!removed) return { ok: false, message: `No existe una publicación con id ${entryId} en tu muro.` }
  return { ok: true, message: 'Publicación borrada.', data: { id: entryId, deleted: true } }
}
