/**
 * Operational audit log + security notifications for agent-driven config
 * changes (Sprint 4 US-4).
 *
 * After a successful patch_store_configuration, we:
 *   1. append an entry to a capped audit log at metadata.ucp_agent_audit,
 *   2. fire an admin/ops security notification (Telegram) for every change,
 *   3. email the seller when a *sensitive* block changed.
 *
 * Sensitive = financially-impactful blocks an agent could flip to the seller's
 * detriment. Note that the truly irreversible sections — payments (pagos) and
 * custom domain (canal) — are OAuth-bound and structurally NOT patchable via
 * MCP at all (they require the manual UI), which is the strongest form of the
 * "sensitive blocks need a manual step" guardrail.
 *
 * Best-effort throughout: a logging or notification failure must never fail the
 * patch the seller's agent already applied.
 */

import { db } from './supabase'
import { tgNotify } from './telegram'
import { getSellerEmail, sendAgentConfigAlert } from './email'
import type { AgentShop } from './agent-auth'
import type { ApplyConfigResult } from './apply-config-manifest'

const AUDIT_KEY = 'ucp_agent_audit'
const AUDIT_CAP = 50
const SENSITIVE_BLOCKS = new Set(['offers', 'shipping'])

export interface AgentAuditEntry {
  at: string
  tool: string
  applied_blocks: string[]
  fields: Record<string, string[]>
  sensitive_blocks: string[]
}

/** Append one entry to the capped audit log at metadata.ucp_agent_audit (re-reads
 *  current metadata so it composes with any preceding write). Best-effort. */
async function appendAuditEntry(shopId: string, entry: AgentAuditEntry): Promise<void> {
  try {
    const { data } = await db.from('marketplace_shops').select('metadata').eq('id', shopId).maybeSingle()
    const meta = (data?.metadata ?? {}) as Record<string, unknown>
    const log = Array.isArray(meta[AUDIT_KEY]) ? (meta[AUDIT_KEY] as AgentAuditEntry[]) : []
    const next = [entry, ...log].slice(0, AUDIT_CAP)
    await db.from('marketplace_shops').update({ metadata: { ...meta, [AUDIT_KEY]: next } }).eq('id', shopId)
  } catch (e) {
    console.error('[agent-audit] log write failed:', e)
  }
}

export async function recordAgentConfigChange(
  shop: AgentShop,
  result: ApplyConfigResult,
  tool = 'patch_store_configuration',
): Promise<void> {
  const applied = result.blocks.filter((b) => b.status === 'applied')
  if (applied.length === 0) return

  const fields: Record<string, string[]> = {}
  for (const b of applied) fields[b.key] = b.appliedFields
  const sensitive = applied.map((b) => b.key).filter((k) => SENSITIVE_BLOCKS.has(k))

  const entry: AgentAuditEntry = {
    at: new Date().toISOString(),
    tool,
    applied_blocks: applied.map((b) => b.key),
    fields,
    sensitive_blocks: sensitive,
  }

  // 1) Append to the capped audit log (top-level metadata, preserved across
  //    settings patches).
  await appendAuditEntry(shop.id, entry)

  // 2) Admin/ops security notification — always.
  try {
    await tgNotify(
      `🤖⚙️ Agente modificó config de *${shop.name ?? shop.slug ?? shop.id}*\n` +
      `Bloques: ${entry.applied_blocks.join(', ')}` +
      (sensitive.length ? `\n⚠️ Sensible: ${sensitive.join(', ')}` : ''),
    )
  } catch (e) {
    console.error('[agent-audit] telegram notify failed:', e)
  }

  // 3) Seller email — only on sensitive changes (the "security notification").
  if (sensitive.length > 0) {
    try {
      const email = await getSellerEmail(shop.clerk_user_id)
      if (email) {
        await sendAgentConfigAlert({
          to: email,
          shopName: shop.name ?? 'tu tienda',
          blocks: entry.applied_blocks,
          sensitive,
        })
      }
    } catch (e) {
      console.error('[agent-audit] seller email failed:', e)
    }
  }
}

/**
 * Audit + admin-notify a seller agent's offer response (accept / counter /
 * decline). Accepting commits a sale at the offer price, so it's flagged
 * sensitive. Best-effort — never fails the response the agent already made.
 */
export async function recordAgentOfferAction(
  shop: AgentShop,
  entry: { offerId: string; action: 'accept' | 'counter' | 'decline'; counterAmountCents?: number },
): Promise<void> {
  await appendAuditEntry(shop.id, {
    at: new Date().toISOString(),
    tool: 'respond_to_offer',
    applied_blocks: [`offer:${entry.action}`],
    fields: { [entry.action]: [entry.offerId] },
    sensitive_blocks: entry.action === 'accept' ? ['offer_accept'] : [],
  })
  try {
    await tgNotify(
      `🤖🤝 Agente respondió una oferta (*${entry.action}*) en *${shop.name ?? shop.slug ?? shop.id}* — oferta ${entry.offerId}` +
      (entry.action === 'accept' ? '\n⚠️ Venta comprometida al precio de la oferta.' : ''),
    )
  } catch (e) {
    console.error('[agent-audit] telegram notify failed:', e)
  }
}

/**
 * Audit + notify a seller agent's listing change. A price change moves what
 * buyers pay → sensitive → the seller also gets a security email. Best-effort.
 */
export async function recordAgentListingAction(
  shop: AgentShop,
  entry: { productId: string; fields: string[]; title?: string },
): Promise<void> {
  const sensitive = entry.fields.includes('price')
  await appendAuditEntry(shop.id, {
    at: new Date().toISOString(),
    tool: 'manage_listing',
    applied_blocks: [`listing:${entry.productId}`],
    fields: { [entry.productId]: entry.fields },
    sensitive_blocks: sensitive ? ['listing_price'] : [],
  })
  try {
    await tgNotify(
      `🤖📦 Agente modificó un anuncio en *${shop.name ?? shop.slug ?? shop.id}* — ${entry.fields.join(', ')}` +
      (entry.title ? ` («${entry.title}»)` : '') + (sensitive ? '\n⚠️ Cambió el precio.' : ''),
    )
  } catch (e) {
    console.error('[agent-audit] telegram notify failed:', e)
  }
  if (sensitive) {
    try {
      const email = await getSellerEmail(shop.clerk_user_id)
      const label = `Precio de anuncio${entry.title ? ` — ${entry.title}` : ''}`
      if (email) {
        await sendAgentConfigAlert({ to: email, shopName: shop.name ?? 'tu tienda', blocks: [label], sensitive: [label] })
      }
    } catch (e) {
      console.error('[agent-audit] seller email failed:', e)
    }
  }
}
