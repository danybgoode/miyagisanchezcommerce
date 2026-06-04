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
  //    settings patches). Re-read so we append to the post-apply metadata.
  try {
    const { data } = await db.from('marketplace_shops').select('metadata').eq('id', shop.id).maybeSingle()
    const meta = (data?.metadata ?? {}) as Record<string, unknown>
    const log = Array.isArray(meta[AUDIT_KEY]) ? (meta[AUDIT_KEY] as AgentAuditEntry[]) : []
    const next = [entry, ...log].slice(0, AUDIT_CAP)
    await db.from('marketplace_shops').update({ metadata: { ...meta, [AUDIT_KEY]: next } }).eq('id', shop.id)
  } catch (e) {
    console.error('[agent-audit] log write failed:', e)
  }

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
