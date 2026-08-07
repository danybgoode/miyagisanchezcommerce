import { expect, test } from '@playwright/test'
import { FLAG_CATALOG, FLAG_KEYS } from '../lib/flag-catalog'
import {
  frontendGoldenFlagDefinitionEntries,
  OWNED_SHOP_ONLY_DESCRIPTION,
} from '../lib/golden-flag-definition-catalog'
import { resolveFlagSyncConfig } from '../scripts/sync-flag-catalog'

type SharedFlagContractEntry = {
  key: string
  definition: {
    description: string
    defaultVariantKey: 'off' | 'on'
    polarity: 'enablement' | 'killswitch'
    criticality: 'low' | 'medium' | 'high'
  }
}

// Independently pinned from Golden's latest live `miyagi` registry on 2026-08-01.
// This catches a change to any shared-definition field before sync can 409.
const SHARED_FLAG_CONTRACT = [
  {
    key: 'catalog.bulk_enabled',
    definition: {
      description: 'Editar muchos productos a la vez (selección masiva). Actívala para permitir cambios masivos de precio, categoría, etc.; por seguridad empieza apagada, ya que un error afectaría muchos productos de golpe.',
      defaultVariantKey: 'on', polarity: 'killswitch', criticality: 'high',
    },
  },
  {
    key: 'catalog.inventory_channels_enabled',
    definition: {
      description: 'Modos de inventario (sin límite / sobre pedido), publicar o no cada producto en Mercado Libre, y precio distinto para ML. Actívala para desbloquear estas opciones por producto; apagada, todo producto usa inventario normal con existencias contadas.',
      defaultVariantKey: 'on', polarity: 'enablement', criticality: 'high',
    },
  },
  {
    key: 'catalog.owned_shop_only_enabled',
    definition: {
      description: OWNED_SHOP_ONLY_DESCRIPTION,
      defaultVariantKey: 'on', polarity: 'killswitch', criticality: 'high',
    },
  },
  {
    key: 'checkout.rental_pricing_enabled',
    definition: {
      description: 'Cobro automático de rentas (noches × tarifa + depósito). Actívala para que el checkout calcule el cobro completo de una renta; apagada, las rentas se coordinan directamente con el vendedor.',
      defaultVariantKey: 'on', polarity: 'enablement', criticality: 'high',
    },
  },
  {
    key: 'checkout.stripe_enabled',
    definition: {
      description: 'Pagos con tarjeta vía Stripe. Actívala para permitir pagos con tarjeta; apágala para quitar Stripe de todo el checkout (los demás métodos de pago siguen funcionando).',
      defaultVariantKey: 'on', polarity: 'killswitch', criticality: 'high',
    },
  },
  {
    key: 'ml.publish_enabled',
    definition: {
      description: 'Publicar productos en Mercado Libre, paso 3. Actívala para permitir publicar y editar productos en ML desde aquí; apagada, esa opción no aparece.',
      defaultVariantKey: 'on', polarity: 'enablement', criticality: 'high',
    },
  },
  {
    key: 'ml.sync_enabled',
    definition: {
      description: 'Sincronización de inventario con Mercado Libre en ambos sentidos. Actívala para mantener el stock igual en los dos lados automáticamente; apágala para detener la sincronización al instante si algo sale mal. Por seguridad, empieza apagada.',
      defaultVariantKey: 'on', polarity: 'killswitch', criticality: 'high',
    },
  },
  {
    key: 'ml.sync_paywall_enabled',
    definition: {
      description: 'Cobro por activar la sincronización de inventario con ML. Actívala para que activar la sincronización requiera un plan de pago; apagada, cualquier vendedor conectado puede sincronizar gratis.',
      defaultVariantKey: 'on', polarity: 'enablement', criticality: 'low',
    },
  },
  {
    key: 'ops.profit_enabled',
    definition: {
      description: 'Panel de ganancias y márgenes para vendedores. Actívala para mostrar el panel y empezar a registrar cada venta; apagada, no hay panel ni registro.',
      defaultVariantKey: 'on', polarity: 'enablement', criticality: 'medium',
    },
  },
  {
    key: 'shipping.arranged_only_enabled',
    definition: {
      description: 'Entrega acordada por vendedor, anuncio por anuncio. Actívala para que un vendedor pueda marcar un anuncio como "solo entrega acordada" (oculta la paquetería automática y el comprador coordina directo); apagada, todos los anuncios se comportan como hoy (paquetería normal).',
      defaultVariantKey: 'on', polarity: 'enablement', criticality: 'high',
    },
  },
  {
    key: 'shipping.correos_enabled',
    definition: {
      description: 'Tarifa económica de Correos de México en el checkout. Actívala para ofrecer esta opción de envío económico; apagada, esta tarifa nunca aparece (independiente de Envía).',
      defaultVariantKey: 'on', polarity: 'enablement', criticality: 'high',
    },
  },
  {
    key: 'shipping.envia_enabled',
    definition: {
      description: 'Cotización y envío automático con Envía.com. Actívala cuando la cuenta de Envía esté lista para usarse; apagada, los compradores solo ven entrega acordada o recolección en tienda.',
      defaultVariantKey: 'off', polarity: 'enablement', criticality: 'high',
    },
  },
] as const satisfies readonly SharedFlagContractEntry[]

function definitionFor(key: string) {
  const definition = frontendGoldenFlagDefinitionEntries().find((entry) => entry.key === key)?.definition
  expect(definition, `missing frontend definition for ${key}`).toBeDefined()
  return definition!
}

test('frontend publishes its deterministic 41-definition fragment and omits backend-only orders', () => {
  const entries = frontendGoldenFlagDefinitionEntries()

  expect(entries).toHaveLength(41)
  expect(entries.map((entry) => entry.key)).toEqual([...entries.map((entry) => entry.key)].sort())
  expect(entries.map((entry) => entry.key)).not.toContain('ml.orders_enabled')
  expect(entries.map((entry) => entry.key)).toEqual(
    FLAG_KEYS.filter((key) => FLAG_CATALOG[key].enforcement !== 'backend').sort(),
  )
})

test('shared definitions exactly match the independently pinned Golden contract', () => {
  const entries = frontendGoldenFlagDefinitionEntries()
  const definitions = new Map(entries.map((entry) => [entry.key, entry.definition]))

  expect(
    entries
      .filter((entry) => entry.definition.metadata?.enforcement === 'both')
      .map((entry) => entry.key),
  ).toEqual(SHARED_FLAG_CONTRACT.map((entry) => entry.key).sort())

  for (const { key, definition } of SHARED_FLAG_CONTRACT) {
    expect(definitions.get(key)).toEqual({
      valueType: 'boolean',
      description: definition.description,
      defaultVariantKey: definition.defaultVariantKey,
      variants: [
        { key: 'off', value: false },
        { key: 'on', value: true },
      ],
      rules: [],
      metadata: {
        source: 'miyagi',
        polarity: definition.polarity,
        criticality: definition.criticality,
        enforcement: 'both',
      },
    })
  }
})

test('the migrated catalog retains live Golden defaults instead of local compile defaults', () => {
  const definitions = frontendGoldenFlagDefinitionEntries()

  expect(definitions.filter(({ definition }) => definition.defaultVariantKey === 'off')).toEqual([
    expect.objectContaining({ key: 'partners.recruiting_v3_enabled' }),
    expect.objectContaining({ key: 'shipping.envia_enabled' }),
  ])
  expect(definitionFor('catalog.owned_shop_only_enabled')).toMatchObject({
    defaultVariantKey: 'on',
    metadata: { polarity: 'killswitch', criticality: 'high', enforcement: 'both' },
  })
})

test('owned-shop uses the shared live-by-default kill-switch definition', () => {
  expect(definitionFor('catalog.owned_shop_only_enabled')).toEqual({
    valueType: 'boolean',
    description: OWNED_SHOP_ONLY_DESCRIPTION,
    defaultVariantKey: 'on',
    variants: [
      { key: 'off', value: false },
      { key: 'on', value: true },
    ],
    rules: [],
    metadata: {
      source: 'miyagi',
      polarity: 'killswitch',
      criticality: 'high',
      enforcement: 'both',
    },
  })
})

test('sync command requires its dedicated operator credential', () => {
  expect(resolveFlagSyncConfig({})).toEqual({ ok: false, error: 'GROWTH_ENGINE_URL is required' })
  expect(resolveFlagSyncConfig({ GROWTH_ENGINE_URL: 'https://golden.example' })).toEqual({
    ok: false,
    error: 'GOLDEN_BEANS_FLAG_SYNC_KEY is required',
  })
  expect(resolveFlagSyncConfig({
    GROWTH_ENGINE_URL: 'https://golden.example/',
    GOLDEN_BEANS_FLAG_SYNC_KEY: 'operator-only-test-key',
  })).toEqual({
    ok: true,
    config: {
      baseUrl: 'https://golden.example/',
      flagSyncKey: 'operator-only-test-key',
    },
  })
})
