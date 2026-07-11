-- admin-flags-cleanup fast-follow chore — the description sweep in
-- 20260711190000_flags_description_polish.sql covered 27 of the 28 known
-- flags; shipping.arranged_only_enabled was seeded by its own epic migration
-- (20260711150000_arranged_only_enabled_flag.sql) BEFORE that sweep ran, in
-- English/technical language ("gates the per-listing delivery_mode...") —
-- inconsistent with every other flag's plain es-MX "what it does + what
-- ON/OFF means" copy. This brings the last flag into the same style.
-- Additive/idempotent, never touches `enabled`/`updated_at`/`updated_by`.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('shipping.arranged_only_enabled', false, 'enablement',
    'Entrega acordada por vendedor, anuncio por anuncio. Actívala para que un vendedor pueda marcar un anuncio como "solo entrega acordada" (oculta la paquetería automática y el comprador coordina directo); apagada, todos los anuncios se comportan como hoy (paquetería normal).')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  polarity = EXCLUDED.polarity;
