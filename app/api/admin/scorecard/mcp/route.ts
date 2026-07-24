/**
 * POST /api/admin/scorecard/mcp — merchant activation scorecard · Sprint 2,
 * Story 2.3. A minimal MCP-shaped (JSON-RPC 2.0: `initialize`, `tools/list`,
 * `tools/call`) read-only agent surface exposing ONE tool,
 * `get_activation_scorecard` (`lib/scorecard/mcp-tool.ts`), over the exact
 * same `loadScorecard` / `resolveScorecard` pair the UI (Story 2.1) and CSV
 * export (Story 2.2) call — same filters, same schema version, same typed
 * degraded states.
 *
 * DEVIATION FROM THE BRIEF, flagged explicitly (not silently resolved): the
 * epic brief describes this as an "`ms_admin_`-authenticated" tool,
 * modeled on the seller-facing `POST /api/ucp/mcp` dispatcher's Bearer-
 * credential pattern (`ms_agent_`/`ms_connector_`/`ms_partner_`,
 * `lib/agent-auth.ts` / `lib/partner-auth.ts`). Verified 2026-07-24: no
 * `ms_admin_` credential shape exists ANYWHERE in this codebase — only the
 * three seller/promoter-scoped prefixes above. Introducing a fourth would
 * mean a new credential-storage column/table (generate, hash, show-once,
 * rotate — the exact machinery `lib/agent-auth.ts#generateAgentToken` and
 * `lib/partner-auth.ts#generatePartnerToken` already needed for THEIR
 * shapes), which is a migration — directly contradicting this epic's own
 * "no migration" / LOW-risk / additive posture (README, epic brief
 * guardrails). Bolting an admin-scoped tool into the existing 4000+-line
 * `/api/ucp/mcp` dispatcher (entirely built around per-shop Bearer auth)
 * would also be invasive for a read-only epic.
 *
 * Given that, this route reuses `authorizeRelationshipRequest`
 * (`lib/relationship-access.ts`) — the SAME flag-first-then-Clerk-admin gate
 * SD2 already prescribes for "the API" — rather than inventing a new
 * credential. `lib/admin/guard.ts`'s own header already documents the
 * platform's posture: "Clerk-only as of S2.3 — every admin page/route is
 * gated by Clerk admin identity"; this route follows that, consistently
 * with every other scorecard surface. An MCP client authenticates with the
 * admin's own Clerk session (same-origin cookie), not a portable token —
 * a real limitation for a genuinely portable agent credential, but correct
 * for "admin-authenticated and read-only" (epic decision 4) without adding
 * a migration this LOW-risk epic doesn't otherwise need.
 *
 * READ-ONLY: only POST is exported, and it never writes — every branch
 * below terminates in `loadScorecard` (all `.select()`/GET, transitively)
 * or a static tool-definition response.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authorizeRelationshipRequest } from '@/lib/relationship-access'
import { loadScorecard } from '@/lib/scorecard/loader'
import { boundScorecard } from '@/lib/scorecard/bound'
import { SCORECARD_SCHEMA_VERSION } from '@/lib/scorecard/dictionary'
import { SCORECARD_TOOL_NAME, SCORECARD_TOOL_DEFINITION, parseScorecardMcpFilters, clampMaxIds } from '@/lib/scorecard/mcp-tool'

export const dynamic = 'force-dynamic'

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: { name?: string; arguments?: Record<string, unknown> }
}

function rpcError(id: string | number | null, code: number, message: string, status: number) {
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } }, { status })
}

export async function POST(req: NextRequest) {
  const auth = await authorizeRelationshipRequest(req)
  if (auth.error) return auth.error
  if (!auth.actor.isAdmin) {
    return NextResponse.json({ ok: false, error: 'Solo administradores.' }, { status: 403 })
  }

  let body: JsonRpcRequest
  try {
    body = (await req.json()) as JsonRpcRequest
  } catch {
    return rpcError(null, -32700, 'JSON inválido', 400)
  }

  const id = body.id ?? null
  const method = body.method

  if (method === 'initialize') {
    return NextResponse.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'miyagi-admin-scorecard', version: String(SCORECARD_SCHEMA_VERSION) },
      },
    })
  }

  if (method === 'tools/list') {
    return NextResponse.json({ jsonrpc: '2.0', id, result: { tools: [SCORECARD_TOOL_DEFINITION] } })
  }

  if (method === 'tools/call') {
    const toolName = body.params?.name
    if (toolName !== SCORECARD_TOOL_NAME) {
      return rpcError(id, -32601, `Herramienta desconocida: ${String(toolName)}`, 404)
    }

    const args = body.params?.arguments ?? {}
    const maxIds = clampMaxIds(args.max_ids)
    const filters = parseScorecardMcpFilters(args)
    const result = await loadScorecard(filters)
    if (!result.ok) {
      return NextResponse.json({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: result.error }) }], isError: true },
      })
    }

    const bounded = boundScorecard(result.scorecard, maxIds)
    return NextResponse.json({
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, scorecard: bounded }) }] },
    })
  }

  return rpcError(id, -32601, `Método desconocido: ${String(method)}`, 400)
}
