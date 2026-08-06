import type { FlagDefinition, FlagDefinitionSyncEntry } from '@golden-beans/sdk'
import type { FlagCriticality, FlagEnforcement, FlagKey, FlagPolarity } from './flag-catalog'

type FrontendGoldenFlagKey = Exclude<FlagKey, 'ml.orders_enabled'>

type ImmutableDefinitionSeed = {
  description: string
  defaultVariantKey: 'off' | 'on'
  polarity: FlagPolarity
  criticality: FlagCriticality
  enforcement: FlagEnforcement
}

export const OWNED_SHOP_ONLY_DESCRIPTION =
  'Owned-shop-only buyability and publication controls. The capability is live by default; turning this flag OFF is the deliberate kill switch.'

/**
 * The 39 pre-existing rows are copied verbatim from Golden's live, immutable
 * `miyagi` registry; owned-shop is the fortieth, newly managed definition.
 * This app owns this copy so future registrations do not depend on Golden's
 * retired, project-specific importer. Descriptions are migration data, not
 * executable instructions; editorial changes require a deliberate new version.
 */
const IMMUTABLE_FRONTEND_DEFINITION_SEEDS = {
  'catalog.bulk_enabled': {
    description: 'Editar muchos productos a la vez (selección masiva). Actívala para permitir cambios masivos de precio, categoría, etc.; por seguridad empieza apagada, ya que un error afectaría muchos productos de golpe.',
    defaultVariantKey: 'on', polarity: 'killswitch', criticality: 'high', enforcement: 'both',
  },
  'catalog.inventory_channels_enabled': {
    description: 'Modos de inventario (sin límite / sobre pedido), publicar o no cada producto en Mercado Libre, y precio distinto para ML. Actívala para desbloquear estas opciones por producto; apagada, todo producto usa inventario normal con existencias contadas.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'high', enforcement: 'both',
  },
  'catalog.owned_shop_only_enabled': {
    description: OWNED_SHOP_ONLY_DESCRIPTION,
    defaultVariantKey: 'on', polarity: 'killswitch', criticality: 'high', enforcement: 'both',
  },
  'checkout.rental_pricing_enabled': {
    description: 'Cobro automático de rentas (noches × tarifa + depósito). Actívala para que el checkout calcule el cobro completo de una renta; apagada, las rentas se coordinan directamente con el vendedor.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'high', enforcement: 'both',
  },
  'checkout.stripe_enabled': {
    description: 'Pagos con tarjeta vía Stripe. Actívala para permitir pagos con tarjeta; apágala para quitar Stripe de todo el checkout (los demás métodos de pago siguen funcionando).',
    defaultVariantKey: 'on', polarity: 'killswitch', criticality: 'high', enforcement: 'both',
  },
  'configurator.enabled': {
    description: 'Subir diseño o arte personalizado en productos configurables de impresión. Apágala para quitar solo esa opción de subir arte; el resto del selector de tamaño/material sigue funcionando igual.',
    defaultVariantKey: 'on', polarity: 'killswitch', criticality: 'low', enforcement: 'frontend',
  },
  'content.overrides_enabled': {
    description: 'Editar textos del sitio desde el admin sin redeploy, incluidos anuncios. Apágala para volver a los textos fijos del código, sin anuncios ni ediciones en vivo.',
    defaultVariantKey: 'on', polarity: 'killswitch', criticality: 'low', enforcement: 'frontend',
  },
  'domain.paywall_enabled': {
    description: 'Cobro por dominio propio personalizado. Actívala para que agregar un dominio propio requiera pago; apagada, los dominios propios son gratis.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'medium', enforcement: 'frontend',
  },
  'events.quantity_enabled': {
    description: 'Comprar más de un boleto de evento en una sola compra. Actívala para permitir comprar varios boletos a la vez; apagada, solo se puede comprar uno por compra.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'low', enforcement: 'frontend',
  },
  'growth.founding_merchants_enabled': {
    description: 'Campaña pública de Tiendas Fundadoras: con la flag encendida, /vende/fundadoras acepta solicitudes y la ruta de captura pública queda activa. Con la flag apagada la página muestra un estado cerrado veraz y la ruta de escritura rechaza. La capacidad (25 comercios) se aplica de forma independiente. Actívala solo después de una solicitud de prueba desechable en producción.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'low', enforcement: 'frontend',
  },
  'growth.telemetry_enabled': {
    description: 'Miyagi platform flag: growth.telemetry_enabled.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'low', enforcement: 'frontend',
  },
  'launchpad.enabled': {
    description: 'Portal de convocatorias para autores (bookshop launchpad). Actívala para abrir el envío de manuscritos, la revisión y las campañas de votación; apagada, esas páginas no existen.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'low', enforcement: 'frontend',
  },
  'mcp.apply_price.enabled': {
    description: 'Herramienta MCP apply_price: un agente puede aplicar un precio calculado a una variante en vivo (mismo flujo que el Aplicar del Analizador de ganancias). Actívala solo tras la prueba en vivo con carrito; apagada, la herramienta responde "no disponible".',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'medium', enforcement: 'frontend',
  },
  'mcp.checkout_config.enabled': {
    description: 'Bloque "checkout" de patch_store_configuration (MCP): un agente puede ajustar la presentación del checkout (escrow, WhatsApp, teléfono, efectivo al recoger). La CLABE y el correo de contacto nunca se configuran por agente. Actívala solo tras la prueba en vivo; apagada, el bloque se rechaza.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'medium', enforcement: 'frontend',
  },
  'mcp.configure_options.enabled': {
    description: 'Herramienta MCP configure_listing_options: un agente puede crear opciones con precio (dimensiones, combinaciones y niveles por cantidad) en un anuncio. Actívala solo tras la prueba en vivo; apagada, la herramienta responde "no disponible".',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'low', enforcement: 'frontend',
  },
  'mcp.delete_listing.enabled': {
    description: 'Herramienta MCP delete_listing: un agente puede eliminar (borrado suave) un anuncio de su propia tienda. Actívala solo tras la prueba en vivo; apagada, la herramienta responde "no disponible".',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'medium', enforcement: 'frontend',
  },
  'mcp.support_config.enabled': {
    description: 'Bloque "support" de patch_store_configuration (MCP): un agente puede configurar los apoyos (propinas) — activarlos crea un producto real en el catálogo. Actívala solo tras la prueba en vivo; apagada, el bloque se rechaza.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'medium', enforcement: 'frontend',
  },
  'migrations.connector_enabled': {
    description: 'Traer una tienda de Shopify a Miyagi automáticamente. Actívala para habilitar el conector y el reporte de compatibilidad; apagada, esa opción de migración no aparece.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'low', enforcement: 'frontend',
  },
  'ml.connect_enabled': {
    description: 'Conexión con Mercado Libre, paso 1 (cuenta). Actívala para mostrar el botón de conectar cuenta de ML; apagada, esa sección no aparece.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'low', enforcement: 'frontend',
  },
  'ml.import_enabled': {
    description: 'Importar catálogo desde Mercado Libre, paso 2. Actívala para permitir importar productos ya publicados en ML; apagada, la página de importación no existe.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'low', enforcement: 'frontend',
  },
  'ml.publish_enabled': {
    description: 'Publicar productos en Mercado Libre, paso 3. Actívala para permitir publicar y editar productos en ML desde aquí; apagada, esa opción no aparece.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'high', enforcement: 'both',
  },
  'ml.sync_enabled': {
    description: 'Sincronización de inventario con Mercado Libre en ambos sentidos. Actívala para mantener el stock igual en los dos lados automáticamente; apágala para detener la sincronización al instante si algo sale mal. Por seguridad, empieza apagada.',
    defaultVariantKey: 'on', polarity: 'killswitch', criticality: 'high', enforcement: 'both',
  },
  'ml.sync_paywall_enabled': {
    description: 'Cobro por activar la sincronización de inventario con ML. Actívala para que activar la sincronización requiera un plan de pago; apagada, cualquier vendedor conectado puede sincronizar gratis.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'low', enforcement: 'both',
  },
  'notifications.buyer_moneypath_enabled': {
    description: 'Identificar al comprador real en envíos y devoluciones. Actívala (recomendado) para dirigir notificaciones al comprador correcto; apágala para regresar al aviso genérico por correo que había antes.',
    defaultVariantKey: 'on', polarity: 'killswitch', criticality: 'low', enforcement: 'frontend',
  },
  'onboarding.three_doors_enabled': {
    description: 'Flujo de bienvenida guiado para un vendedor nuevo sin tienda todavía. Actívala para mandarlo a ese flujo en lugar del formulario normal; apagada, todos usan el formulario de siempre.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'low', enforcement: 'frontend',
  },
  'ops.profit_enabled': {
    description: 'Panel de ganancias y márgenes para vendedores. Actívala para mostrar el panel y empezar a registrar cada venta; apagada, no hay panel ni registro.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'medium', enforcement: 'both',
  },
  'partners.mcp_enabled': {
    description: 'Credencial multi-tienda ms_partner_ para socios (Miyagi Partners): con la flag apagada, un token de socio se rechaza igual que un token desconocido. Actívala solo tras la prueba en vivo del recorrido de Sprint 1.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'medium', enforcement: 'frontend',
  },
  'partners.recruiting_v3_enabled': {
    description: 'Miyagi Partners recruiting v3 for founding US commerce operators. Enables the /us proposition and intake, neutral activation, and track-aware workspace orientation. Keep OFF until the full operator-versus-Promotor authorization smoke passes.',
    defaultVariantKey: 'off', polarity: 'enablement', criticality: 'high', enforcement: 'frontend',
  },
  pdp_redesign: {
    description: 'Diseño nuevo de la página de producto. Actívala para mostrar el diseño nuevo; apágala para regresar al diseño anterior al instante.',
    defaultVariantKey: 'on', polarity: 'killswitch', criticality: 'low', enforcement: 'frontend',
  },
  'promoter.activation_crm_enabled': {
    description: 'Registro operativo de relación con comercios fundadores: con la flag encendida, /promotor/cerrar muestra el paso de captura del comercio y las rutas de creación/consulta/consentimiento de la relación quedan activas. Actívala solo después de las pruebas de alcance por rol y la verificación en vivo de esta migración.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'medium', enforcement: 'frontend',
  },
  'promoter.enabled': {
    description: 'Programa de promotores con comisión. Actívala para mostrar los códigos de promotor y el seguimiento de comisión; apagada, esas superficies quedan ocultas.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'low', enforcement: 'frontend',
  },
  'promoter.partner_portfolio_enabled': {
    description: 'Cartera de comercios del Socio: con la flag encendida, /partner muestra la sección de cartera (comercios con acceso otorgado u hospedados por el socio, ordenados por vencimiento) y se habilitan GET /api/partner/portfolio, GET/PUT /api/admin/sla-policy, POST /api/admin/relationship/[id]/reassign, las rutas de borrador de seguimiento, el cron de recordatorios y las herramientas del agente socio (MCP). Con la flag apagada /partner queda idéntico a hoy y esas rutas responden 404, indistinguible de…',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'medium', enforcement: 'frontend',
  },
  'promoter.preview_verified_approval_enabled': {
    description: 'Aprobación verificada del comerciante para vistas previas privadas: con la flag encendida, aprobar una propuesta exige un código de un solo uso enviado al correo (o WhatsApp) del comerciante, de modo que la aprobación quede ligada a quien controla ese contacto. Actívala solo tras probar el recorrido con un comerciante real.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'medium', enforcement: 'frontend',
  },
  'promoter.private_preview_enabled': {
    description: 'Vista previa privada para tiendas creadas por promotores (Founding Merchant): con la flag encendida, los productos se crean como borrador privado y se genera un enlace de vista previa revocable en vez de publicarse de inmediato. Actívala solo tras la prueba en vivo del recorrido de Sprint 1.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'medium', enforcement: 'frontend',
  },
  'promoter.transfer_enabled': {
    description: 'Cierre de comisión de promotor por transferencia (SPEI/DiMo/CoDi). Actívala para ofrecer transferencia como forma de cobro; apagada, el cierre solo se puede pagar con Stripe.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'medium', enforcement: 'frontend',
  },
  'seller_agent.connector_url_enabled': {
    description: 'URL personal de conexión de agente (Claude, un clic). Actívala para permitir esta forma nueva de conectar el agente del vendedor; apagada, solo funciona el método anterior por token.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'low', enforcement: 'frontend',
  },
  'seller.shell_on_sell_enabled': {
    description: 'Menú y barra de vendedor en las páginas de Vender. Apágala para regresar de inmediato al menú normal de comprador en esas páginas.',
    defaultVariantKey: 'on', polarity: 'killswitch', criticality: 'low', enforcement: 'frontend',
  },
  'shipping.arranged_only_enabled': {
    description: 'Entrega acordada por vendedor, anuncio por anuncio. Actívala para que un vendedor pueda marcar un anuncio como "solo entrega acordada" (oculta la paquetería automática y el comprador coordina directo); apagada, todos los anuncios se comportan como hoy (paquetería normal).',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'high', enforcement: 'both',
  },
  'shipping.correos_enabled': {
    description: 'Tarifa económica de Correos de México en el checkout. Actívala para ofrecer esta opción de envío económico; apagada, esta tarifa nunca aparece (independiente de Envía).',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'high', enforcement: 'both',
  },
  'shipping.envia_enabled': {
    description: 'Cotización y envío automático con Envía.com. Actívala cuando la cuenta de Envía esté lista para usarse; apagada, los compradores solo ven entrega acordada o recolección en tienda.',
    defaultVariantKey: 'off', polarity: 'enablement', criticality: 'high', enforcement: 'both',
  },
  'subdomain.paywall_enabled': {
    description: 'Cobro por subdominio propio (tuslug.miyagisanchez.com). Actívala para que un subdominio propio requiera pago; apagada, es gratis.',
    defaultVariantKey: 'on', polarity: 'enablement', criticality: 'medium', enforcement: 'frontend',
  },
} as const satisfies Record<FrontendGoldenFlagKey, ImmutableDefinitionSeed>

function definitionFrom(seed: ImmutableDefinitionSeed): FlagDefinition {
  return {
    valueType: 'boolean',
    description: seed.description,
    defaultVariantKey: seed.defaultVariantKey,
    variants: [
      { key: 'off', value: false },
      { key: 'on', value: true },
    ],
    rules: [],
    metadata: {
      source: 'miyagi',
      polarity: seed.polarity,
      criticality: seed.criticality,
      enforcement: seed.enforcement,
    },
  }
}

/**
 * Explicit-only sync: adding a frontend flag requires adding its exact
 * definition above. Medusa alone owns the backend-only `ml.orders_enabled`.
 */
export function frontendGoldenFlagDefinitionEntries(): FlagDefinitionSyncEntry[] {
  return (Object.keys(IMMUTABLE_FRONTEND_DEFINITION_SEEDS) as FrontendGoldenFlagKey[])
    .sort()
    .map((key) => ({ key, definition: definitionFrom(IMMUTABLE_FRONTEND_DEFINITION_SEEDS[key]) }))
}
