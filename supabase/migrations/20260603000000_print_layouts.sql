-- ── Print Edition — Layout document (Builder, Phase 4) ────────────────────────
-- The editorial/layout layer for the printed-edition builder. One layout document
-- per edition: the page composition (pages → ad blocks → per-block style). This is
-- purely editorial state Medusa has no concept of (AGENTS rule #2), same basis as
-- print_ad_submissions / marketplace_offers. The blocks REFERENCE commerce
-- (submission ids, product/seller ids) but the page document itself is ours.
--
-- All actual commerce stays in Medusa; nothing here touches carts/orders/payments.

CREATE TABLE IF NOT EXISTS print_layouts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One layout per edition; cascade-deleted with its edition.
  edition_id  UUID        NOT NULL UNIQUE REFERENCES print_editions(id) ON DELETE CASCADE,
  -- Physical paper preset the builder + print view target: 'carta' | 'media_carta'
  page_size   TEXT        NOT NULL DEFAULT 'carta',
  -- The page composition: { version, density_default, pages: [ { id, kind, density,
  --   blocks: [ { id, kind, source{type,ref_id}, span{col,row}, content{}, style{} } ] } ] }
  document    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Set when the layout is sent to print (US-6); locks further edits.
  locked_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS print_layouts_edition_idx ON print_layouts (edition_id);

-- updated_at trigger (reuses update_updated_at(), already defined by earlier migrations)
DROP TRIGGER IF EXISTS print_layouts_updated_at ON print_layouts;
CREATE TRIGGER print_layouts_updated_at
  BEFORE UPDATE ON print_layouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
