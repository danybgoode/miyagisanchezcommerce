/**
 * POST /api/partner/portfolio/mcp — the Merchant Partner-agent surface
 * (Merchant Partner lifecycle · Sprint 3, Story 3.2). JSON-RPC 2.0
 * (`initialize`, `tools/list`, `tools/call`) over four tools:
 * `list_portfolio`, `get_portfolio_record` (read), `propose_task_update`,
 * `confirm_task_update` (propose/confirm write).
 *
 * A SEPARATE ROUTE (README D2), modeled on
 * `app/api/admin/scorecard/mcp/route.ts`'s precedent — NOT added to
 * `app/api/ucp/mcp/route.ts` (4050 lines, entirely built around per-shop
 * Bearer auth; bolting a multi-shop-portfolio tool set into that dispatcher
 * would be exactly as invasive there as the scorecard epic already
 * documented for its own read-only surface).
 *
 * AUTH: `resolvePartnerPortfolioActor` (`lib/portfolio/partner-portfolio-auth.ts`)
 * — an `ms_partner_` Bearer credential, gated by `partners.mcp_enabled`
 * FIRST, mapped onto the SAME `RelationshipActor` shape `/partner`'s UI
 * route builds, with `isAdmin: false` structurally guaranteed. NEVER
 * `resolveToolShop` (D2 — routes to one shop, denies a multi-grant partner
 * with no `shop_slug`).
 *
 * UI/TOOL AGREEMENT BY CONSTRUCTION: `list_portfolio` calls the SAME
 * `parsePortfolioFilters` + `loadPortfolio` pair `GET /api/partner/portfolio`
 * calls; `get_portfolio_record` reads off the SAME `loadPortfolio` result
 * rather than a second, parallel per-id query, so a cross-partner id is
 * simply ABSENT from the scoped rows — the same 403-shaped "no record
 * fields, indistinguishable from a nonexistent id" the per-id routes
 * already give, achieved here by never having a second population to leak
 * from in the first place. `propose_task_update`/`confirm_task_update` go
 * through `lib/portfolio/propose-server.ts`, which re-runs
 * `resolveRelationshipAccess` on confirm against the CONFIRMING credential.
 *
 * NEVER TOUCHES MEDUSA, NEVER SENDS ANYTHING. Every branch below terminates
 * in `lib/portfolio/{loader,propose-server}.ts`, both of which only read/
 * write Supabase portfolio tables.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolvePartnerPortfolioActor } from '@/lib/portfolio/partner-portfolio-auth'
import { loadPortfolio } from '@/lib/portfolio/loader'
import { parsePortfolioFilters } from '@/lib/portfolio/resolver'
import { createTaskUpdateProposal, confirmTaskUpdateProposal } from '@/lib/portfolio/propose-server'
import type { RelationshipActor } from '@/lib/relationship-access'

export const dynamic = 'force-dynamic'

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: { name?: string; arguments?: Record<string, unknown> }
}

const TOOL_NAMES = ['list_portfolio', 'get_portfolio_record', 'propose_task_update', 'confirm_task_update'] as const
type ToolName = (typeof TOOL_NAMES)[number]
function isToolName(value: unknown): value is ToolName {
  return typeof value === 'string' && (TOOL_NAMES as readonly string[]).includes(value)
}

const TOOL_DEFINITIONS = [
  {
    name: 'list_portfolio',
    description:
      'Lista la cartera de comercios del socio autenticado — misma población y orden que GET /api/partner/portfolio.',
    inputSchema: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: ['needs_action', 'all'] },
        stage: { type: 'string' },
        blocker: { type: 'boolean' },
        due: { type: 'string', enum: ['overdue', 'due_soon', 'scheduled', 'missing'] },
      },
    },
  },
  {
    name: 'get_portfolio_record',
    description: 'Lee UN registro de la cartera del socio — proyección segura, sin datos de contacto.',
    inputSchema: {
      type: 'object',
      properties: { relationshipId: { type: 'string' } },
      required: ['relationshipId'],
    },
  },
  {
    name: 'propose_task_update',
    description:
      'Propone un cambio de acción (crear, editar o completar) — no escribe nada hasta confirm_task_update.',
    inputSchema: {
      type: 'object',
      properties: {
        relationshipId: { type: 'string' },
        taskId: { type: 'string' },
        title: { type: 'string' },
        dueAt: { type: 'string' },
        outcome: { type: 'string' },
        completedAt: { type: 'string' },
        interactionNote: { type: 'string' },
      },
      required: ['relationshipId'],
    },
  },
  {
    name: 'confirm_task_update',
    description: 'Confirma y aplica una propuesta previamente creada con propose_task_update.',
    inputSchema: {
      type: 'object',
      properties: { relationshipId: { type: 'string' }, proposalId: { type: 'string' } },
      required: ['relationshipId', 'proposalId'],
    },
  },
] as const

function rpcError(id: string | number | null, code: number, message: string, status: number) {
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } }, { status })
}

/** `list_portfolio` — the SAME `parsePortfolioFilters` + `loadPortfolio`
 *  pair `GET /api/partner/portfolio` calls, fed from JSON-RPC arguments
 *  instead of a query string. */
async function handleListPortfolio(actor: RelationshipActor, args: Record<string, unknown>) {
  const params = new URLSearchParams()
  if (typeof args.view === 'string') params.set('view', args.view)
  if (typeof args.stage === 'string') params.set('stage', args.stage)
  if (typeof args.blocker === 'boolean') params.set('blocker', String(args.blocker))
  if (typeof args.due === 'string') params.set('due', args.due)

  const filters = parsePortfolioFilters(params)
  const result = await loadPortfolio(actor, filters)
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true, portfolio: result.portfolio }
}

/** `get_portfolio_record` — reads off the SAME scoped `loadPortfolio`
 *  result `list_portfolio` uses (unfiltered), rather than a second,
 *  parallel per-id query. A cross-partner id is simply absent from the
 *  scoped rows, so it 403s with the same shape a genuinely nonexistent id
 *  does — no record fields leaked either way. */
async function handleGetPortfolioRecord(actor: RelationshipActor, args: Record<string, unknown>) {
  const relationshipId = typeof args.relationshipId === 'string' ? args.relationshipId : null
  if (!relationshipId) return { ok: false, error: 'relationshipId requerido.' }

  const result = await loadPortfolio(actor, { view: 'all' })
  if (!result.ok) return { ok: false, error: result.error }

  const row = result.portfolio.rows.find((r) => r.id === relationshipId)
  if (!row) return { ok: false, error: 'No autorizado.', status: 403 }
  return { ok: true, record: row }
}

async function handleProposeTaskUpdate(actor: RelationshipActor, args: Record<string, unknown>) {
  const relationshipId = typeof args.relationshipId === 'string' ? args.relationshipId : null
  if (!relationshipId) return { ok: false, error: 'relationshipId requerido.' }

  const result = await createTaskUpdateProposal(relationshipId, actor, actor.clerkUserId, args)
  if (!result.ok) return { ok: false, error: result.error, status: result.status }
  return { ok: true, proposalId: result.proposalId, diff: result.diff }
}

async function handleConfirmTaskUpdate(actor: RelationshipActor, args: Record<string, unknown>) {
  const relationshipId = typeof args.relationshipId === 'string' ? args.relationshipId : null
  const proposalId = typeof args.proposalId === 'string' ? args.proposalId : null
  if (!relationshipId || !proposalId) return { ok: false, error: 'relationshipId y proposalId requeridos.' }

  const result = await confirmTaskUpdateProposal(relationshipId, proposalId, actor, actor.clerkUserId)
  if (!result.ok) return { ok: false, error: result.error, status: result.status }
  return { ok: true, task: result.task, interactionAdded: result.interactionAdded }
}

async function callTool(name: ToolName, actor: RelationshipActor, args: Record<string, unknown>) {
  if (name === 'list_portfolio') return handleListPortfolio(actor, args)
  if (name === 'get_portfolio_record') return handleGetPortfolioRecord(actor, args)
  if (name === 'propose_task_update') return handleProposeTaskUpdate(actor, args)
  return handleConfirmTaskUpdate(actor, args)
}

export async function POST(req: NextRequest) {
  const auth = await resolvePartnerPortfolioActor(req.headers.get('authorization'), 'portfolio_mcp')
  if (!auth.ok) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32001, message: auth.message ?? 'No autorizado' } },
      { status: 401 },
    )
  }

  let body: JsonRpcRequest
  try {
    const raw = await req.json()
    // `JSON.parse` happily yields `null`, `42` or `"x"` — all valid JSON, none a
    // JSON-RPC request object. Reading `.id` off `null` threw a TypeError and the
    // route answered 500 instead of a well-formed invalid-request response
    // (cross-agent review round 2, PR 311). A malformed request from an
    // ALREADY-AUTHENTICATED caller must still be a protocol error, not a server
    // malfunction — the same reason the `catch` above exists.
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return rpcError(null, -32600, 'Petición inválida', 400)
    }
    body = raw as JsonRpcRequest
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
        serverInfo: { name: 'miyagi-partner-portfolio', version: '1' },
      },
    })
  }

  if (method === 'tools/list') {
    return NextResponse.json({ jsonrpc: '2.0', id, result: { tools: TOOL_DEFINITIONS } })
  }

  if (method === 'tools/call') {
    const toolName = body.params?.name
    if (!isToolName(toolName)) {
      return rpcError(id, -32601, `Herramienta desconocida: ${String(toolName)}`, 404)
    }
    const args = body.params?.arguments ?? {}
    const result = await callTool(toolName, auth.actor, args)
    return NextResponse.json({
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: result.ok === false },
    })
  }

  return rpcError(id, -32601, `Método desconocido: ${String(method)}`, 400)
}
