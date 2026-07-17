/**
 * Pure `send_feedback` input validation — no `next/*`, no `server-only`, no DB
 * import — so the Playwright `api` runner can import it directly (LEARNINGS:
 * keep a pure validator/predicate next-free in its own file; mirrors
 * `lib/partner-tools.ts` and `lib/collection-derive.ts`'s `validateCollectionName`).
 *
 * `platform_feedback.author_kind` also accepts `'agent'` in its CHECK constraint
 * for a future unauthenticated/agent-generic filing path, but no caller mints it
 * yet — `resolveToolShop` only ever resolves a seller or partner credential, so
 * `handleSendFeedback` (app/api/ucp/mcp/route.ts) derives `author_kind` itself
 * from which credential shape resolved, never from caller input.
 */

export const FEEDBACK_CATEGORIES = ['feature', 'mcp-tool', 'bug'] as const
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]

/** Full author-kind domain (schema-level) — see file header re: 'agent'. */
export const FEEDBACK_AUTHOR_KINDS = ['seller', 'partner', 'agent'] as const
export type FeedbackAuthorKind = (typeof FEEDBACK_AUTHOR_KINDS)[number]

const MESSAGE_MIN_LEN = 5
const MESSAGE_MAX_LEN = 2000
const TOOL_NAME_MAX_LEN = 100

export type FeedbackValidation =
  | { ok: true; category: FeedbackCategory; message: string; toolName: string | null }
  | { ok: false; error: string }

/** Validates + trims a `send_feedback` call's raw MCP tool arguments. */
export function validateFeedbackInput(args: Record<string, unknown> | undefined): FeedbackValidation {
  const category = typeof args?.category === 'string' ? args.category : ''
  if (!FEEDBACK_CATEGORIES.includes(category as FeedbackCategory)) {
    return { ok: false, error: `category debe ser una de: ${FEEDBACK_CATEGORIES.join(', ')}.` }
  }

  const message = typeof args?.message === 'string' ? args.message.trim() : ''
  if (message.length < MESSAGE_MIN_LEN) {
    return { ok: false, error: `message es obligatorio (mínimo ${MESSAGE_MIN_LEN} caracteres).` }
  }
  if (message.length > MESSAGE_MAX_LEN) {
    return { ok: false, error: `message es demasiado largo (máximo ${MESSAGE_MAX_LEN} caracteres).` }
  }

  let toolName: string | null = null
  if (args?.tool_name !== undefined && args?.tool_name !== null) {
    if (typeof args.tool_name !== 'string') {
      return { ok: false, error: 'tool_name debe ser texto.' }
    }
    const trimmed = args.tool_name.trim()
    if (trimmed.length > TOOL_NAME_MAX_LEN) {
      return { ok: false, error: `tool_name es demasiado largo (máximo ${TOOL_NAME_MAX_LEN} caracteres).` }
    }
    toolName = trimmed.length > 0 ? trimmed : null
  }

  return { ok: true, category: category as FeedbackCategory, message, toolName }
}
