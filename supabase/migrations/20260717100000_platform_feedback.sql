-- Miyagi Partners · Sprint 3 — additive, scoped to miyagisanchez (shared Supabase).
-- Run in the Supabase SQL editor (applied BY HAND at merge time — a merged file is
-- not an applied migration; verify with `select to_regclass('public.platform_feedback')`
-- per LEARNINGS).
--
-- Structured product-signal channel: the `send_feedback` MCP tool (app/api/ucp/mcp/route.ts)
-- writes one row per report, from whichever credential shape resolved the call. `author_kind`
-- accepts 'agent' in its domain for a future unauthenticated/agent-generic filing path, but no
-- caller mints it yet — today's two callers (seller `ms_agent_`/`ms_connector_` and partner
-- `ms_partner_` credentials, both via `resolveToolShop`) always resolve to 'seller' or 'partner'.
-- Neither Medusa module nor any existing Supabase table models this (AGENTS rule #2 check
-- passed) → new table.
CREATE TABLE IF NOT EXISTS platform_feedback (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  author_kind  TEXT        NOT NULL CHECK (author_kind IN ('seller', 'partner', 'agent')),
  author_id    TEXT        NOT NULL,
  author_label TEXT        NOT NULL,
  category     TEXT        NOT NULL CHECK (category IN ('feature', 'mcp-tool', 'bug')),
  tool_name    TEXT,
  message      TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_feedback_created_idx ON platform_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS platform_feedback_category_idx ON platform_feedback (category);
CREATE INDEX IF NOT EXISTS platform_feedback_author_kind_idx ON platform_feedback (author_kind);
