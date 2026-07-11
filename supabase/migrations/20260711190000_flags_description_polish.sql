-- admin-flags-cleanup chore — refresh every platform_flags description to plain,
-- crystal-clear es-MX copy (what it does + what ON/OFF means), and backfill the
-- three flags that were never seeded at all. Additive/idempotent, never touches
-- a live `enabled` value:
--   - For a row that already exists: ON CONFLICT (key) DO UPDATE touches ONLY
--     `description` (+ `polarity`, since that's also purely informational and
--     already kept in sync with code on every POST /api/admin/flags write) —
--     `enabled`/`updated_at`/`updated_by` are left completely alone.
--   - For a row that doesn't exist yet (catalog.inventory_channels_enabled,
--     catalog.bulk_enabled, shipping.correos_enabled — added to code but never
--     given their own seed migration), the INSERT creates it with the correct
--     `enabled` default from DEFAULT_FLAGS/FLAG_META.
--
-- Also fixes a harmless data typo: configurator.enabled's original seed used
-- polarity 'kill-switch' (hyphenated) instead of 'killswitch' — never read for
-- display (the admin page renders FLAG_META's polarity, not this column), but
-- worth correcting while every row is being touched anyway.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('checkout.stripe_enabled', true, 'killswitch',
    'Pagos con tarjeta vía Stripe. Actívala para permitir pagos con tarjeta; apágala para quitar Stripe de todo el checkout (los demás métodos de pago siguen funcionando).'),
  ('checkout.rental_pricing_enabled', false, 'enablement',
    'Cobro automático de rentas (noches × tarifa + depósito). Actívala para que el checkout calcule el cobro completo de una renta; apagada, las rentas se coordinan directamente con el vendedor.'),
  ('pdp_redesign', true, 'killswitch',
    'Diseño nuevo de la página de producto. Actívala para mostrar el diseño nuevo; apágala para regresar al diseño anterior al instante.'),
  ('domain.paywall_enabled', false, 'enablement',
    'Cobro por dominio propio personalizado. Actívala para que agregar un dominio propio requiera pago; apagada, los dominios propios son gratis.'),
  ('events.quantity_enabled', false, 'enablement',
    'Comprar más de un boleto de evento en una sola compra. Actívala para permitir comprar varios boletos a la vez; apagada, solo se puede comprar uno por compra.'),
  ('shipping.envia_enabled', false, 'enablement',
    'Cotización y envío automático con Envía.com. Actívala cuando la cuenta de Envía esté lista para usarse; apagada, los compradores solo ven entrega acordada o recolección en tienda.'),
  ('shipping.correos_enabled', false, 'enablement',
    'Tarifa económica de Correos de México en el checkout. Actívala para ofrecer esta opción de envío económico; apagada, esta tarifa nunca aparece (independiente de Envía).'),
  ('promoter.enabled', false, 'enablement',
    'Programa de promotores con comisión. Actívala para mostrar los códigos de promotor y el seguimiento de comisión; apagada, esas superficies quedan ocultas.'),
  ('ml.connect_enabled', false, 'enablement',
    'Conexión con Mercado Libre, paso 1 (cuenta). Actívala para mostrar el botón de conectar cuenta de ML; apagada, esa sección no aparece.'),
  ('ml.import_enabled', false, 'enablement',
    'Importar catálogo desde Mercado Libre, paso 2. Actívala para permitir importar productos ya publicados en ML; apagada, la página de importación no existe.'),
  ('ml.publish_enabled', false, 'enablement',
    'Publicar productos en Mercado Libre, paso 3. Actívala para permitir publicar y editar productos en ML desde aquí; apagada, esa opción no aparece.'),
  ('ml.sync_enabled', false, 'killswitch',
    'Sincronización de inventario con Mercado Libre en ambos sentidos. Actívala para mantener el stock igual en los dos lados automáticamente; apágala para detener la sincronización al instante si algo sale mal. Por seguridad, empieza apagada.'),
  ('ml.sync_paywall_enabled', false, 'enablement',
    'Cobro por activar la sincronización de inventario con ML. Actívala para que activar la sincronización requiera un plan de pago; apagada, cualquier vendedor conectado puede sincronizar gratis.'),
  ('ml.orders_enabled', false, 'enablement',
    'Crear un pedido real cuando se vende en Mercado Libre. Actívala para que una venta en ML también cree un pedido en Miyagi; apagada, solo se actualiza el stock, sin crear pedido.'),
  ('subdomain.paywall_enabled', false, 'enablement',
    'Cobro por subdominio propio (tuslug.miyagisanchez.com). Actívala para que un subdominio propio requiera pago; apagada, es gratis.'),
  ('seller_agent.connector_url_enabled', false, 'enablement',
    'URL personal de conexión de agente (Claude, un clic). Actívala para permitir esta forma nueva de conectar el agente del vendedor; apagada, solo funciona el método anterior por token.'),
  ('promoter.transfer_enabled', false, 'enablement',
    'Cierre de comisión de promotor por transferencia (SPEI/DiMo/CoDi). Actívala para ofrecer transferencia como forma de cobro; apagada, el cierre solo se puede pagar con Stripe.'),
  ('configurator.enabled', true, 'killswitch',
    'Subir diseño o arte personalizado en productos configurables de impresión. Apágala para quitar solo esa opción de subir arte; el resto del selector de tamaño/material sigue funcionando igual.'),
  ('ops.profit_enabled', false, 'enablement',
    'Panel de ganancias y márgenes para vendedores. Actívala para mostrar el panel y empezar a registrar cada venta; apagada, no hay panel ni registro.'),
  ('launchpad.enabled', false, 'enablement',
    'Portal de convocatorias para autores (bookshop launchpad). Actívala para abrir el envío de manuscritos, la revisión y las campañas de votación; apagada, esas páginas no existen.'),
  ('notifications.buyer_moneypath_enabled', true, 'killswitch',
    'Identificar al comprador real en envíos y devoluciones. Actívala (recomendado) para dirigir notificaciones al comprador correcto; apágala para regresar al aviso genérico por correo que había antes.'),
  ('content.overrides_enabled', true, 'killswitch',
    'Editar textos del sitio desde el admin sin redeploy, incluidos anuncios. Apágala para volver a los textos fijos del código, sin anuncios ni ediciones en vivo.'),
  ('catalog.inventory_channels_enabled', false, 'enablement',
    'Modos de inventario (sin límite / sobre pedido), publicar o no cada producto en Mercado Libre, y precio distinto para ML. Actívala para desbloquear estas opciones por producto; apagada, todo producto usa inventario normal con existencias contadas.'),
  ('catalog.bulk_enabled', false, 'killswitch',
    'Editar muchos productos a la vez (selección masiva). Actívala para permitir cambios masivos de precio, categoría, etc.; por seguridad empieza apagada, ya que un error afectaría muchos productos de golpe.'),
  ('migrations.connector_enabled', false, 'enablement',
    'Traer una tienda de Shopify a Miyagi automáticamente. Actívala para habilitar el conector y el reporte de compatibilidad; apagada, esa opción de migración no aparece.'),
  ('seller.shell_on_sell_enabled', true, 'killswitch',
    'Menú y barra de vendedor en las páginas de Vender. Apágala para regresar de inmediato al menú normal de comprador en esas páginas.'),
  ('onboarding.three_doors_enabled', false, 'enablement',
    'Flujo de bienvenida guiado para un vendedor nuevo sin tienda todavía. Actívala para mandarlo a ese flujo en lugar del formulario normal; apagada, todos usan el formulario de siempre.')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  polarity = EXCLUDED.polarity;
