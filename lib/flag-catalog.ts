/**
 * Pure, typed Miyagi flag catalog.
 *
 * This is the frontend's single compile-time inventory. `FlagKey` is derived
 * from the object keys, so a key cannot drift from its default/classification
 * maps. Golden's import report uses the same criticality/enforcement vocabulary.
 */
export type FlagCriticality = 'low' | 'medium' | 'high'
export type FlagEnforcement = 'frontend' | 'backend' | 'both'
export type FlagPolarity = 'killswitch' | 'enablement'

export type FlagCatalogEntry = {
  default: boolean
  polarity: FlagPolarity
  criticality: FlagCriticality
  enforcement: FlagEnforcement
}

export const FLAG_CATALOG = {
  'checkout.stripe_enabled': {
    default: true,
    polarity: 'killswitch',
    criticality: 'high',
    enforcement: 'both',
  },
  'checkout.rental_pricing_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'high',
    enforcement: 'both',
  },
  'domain.paywall_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'medium',
    enforcement: 'frontend',
  },
  pdp_redesign: {
    default: true,
    polarity: 'killswitch',
    criticality: 'low',
    enforcement: 'frontend',
  },
  'events.quantity_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'low',
    enforcement: 'frontend',
  },
  'shipping.envia_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'high',
    enforcement: 'both',
  },
  'shipping.correos_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'high',
    enforcement: 'both',
  },
  'shipping.arranged_only_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'high',
    enforcement: 'both',
  },
  'promoter.enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'low',
    enforcement: 'frontend',
  },
  'ml.connect_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'low',
    enforcement: 'frontend',
  },
  'ml.import_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'low',
    enforcement: 'frontend',
  },
  'ml.publish_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'high',
    enforcement: 'both',
  },
  'ml.sync_enabled': {
    default: false,
    polarity: 'killswitch',
    criticality: 'high',
    enforcement: 'both',
  },
  'ml.sync_paywall_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'low',
    enforcement: 'both',
  },
  // No frontend decision callsite exists. The key remains visible here so the
  // shared admin catalog is complete, while Medusa owns the actual enforcement.
  'ml.orders_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'high',
    enforcement: 'backend',
  },
  'subdomain.paywall_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'medium',
    enforcement: 'frontend',
  },
  'seller_agent.connector_url_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'low',
    enforcement: 'frontend',
  },
  'promoter.transfer_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'medium',
    enforcement: 'frontend',
  },
  'configurator.enabled': {
    default: true,
    polarity: 'killswitch',
    criticality: 'low',
    enforcement: 'frontend',
  },
  'ops.profit_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'medium',
    enforcement: 'both',
  },
  'launchpad.enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'low',
    enforcement: 'frontend',
  },
  'notifications.buyer_moneypath_enabled': {
    default: true,
    polarity: 'killswitch',
    criticality: 'low',
    enforcement: 'frontend',
  },
  'content.overrides_enabled': {
    default: true,
    polarity: 'killswitch',
    criticality: 'low',
    enforcement: 'frontend',
  },
  'catalog.inventory_channels_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'high',
    enforcement: 'both',
  },
  'catalog.owned_shop_only_enabled': {
    // Live by default. Golden Beans owns its operational definition and activation;
    // turning this flag OFF is the deliberate rollback.
    default: true,
    polarity: 'killswitch',
    criticality: 'high',
    enforcement: 'both',
  },
  'catalog.bulk_enabled': {
    default: false,
    polarity: 'killswitch',
    criticality: 'high',
    enforcement: 'both',
  },
  'migrations.connector_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'low',
    enforcement: 'frontend',
  },
  'seller.shell_on_sell_enabled': {
    default: true,
    polarity: 'killswitch',
    criticality: 'low',
    enforcement: 'frontend',
  },
  'onboarding.three_doors_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'low',
    enforcement: 'frontend',
  },
  'growth.telemetry_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'low',
    enforcement: 'frontend',
  },
  'mcp.configure_options.enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'low',
    enforcement: 'frontend',
  },
  'mcp.delete_listing.enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'medium',
    enforcement: 'frontend',
  },
  'mcp.apply_price.enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'medium',
    enforcement: 'frontend',
  },
  'mcp.support_config.enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'medium',
    enforcement: 'frontend',
  },
  'mcp.checkout_config.enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'medium',
    enforcement: 'frontend',
  },
  'partners.mcp_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'medium',
    enforcement: 'frontend',
  },
  'promoter.private_preview_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'medium',
    enforcement: 'frontend',
  },
  'promoter.preview_verified_approval_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'medium',
    enforcement: 'frontend',
  },
  'promoter.activation_crm_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'medium',
    enforcement: 'frontend',
  },
  'growth.founding_merchants_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'low',
    enforcement: 'frontend',
  },
  'promoter.partner_portfolio_enabled': {
    default: false,
    polarity: 'enablement',
    criticality: 'medium',
    enforcement: 'frontend',
  },
} as const satisfies Record<string, FlagCatalogEntry>

export type FlagKey = keyof typeof FLAG_CATALOG

export const FLAG_KEYS = Object.freeze(Object.keys(FLAG_CATALOG) as FlagKey[])

export const DEFAULT_FLAGS = Object.freeze(
  Object.fromEntries(FLAG_KEYS.map((key) => [key, FLAG_CATALOG[key].default])) as Record<
    FlagKey,
    boolean
  >,
)
