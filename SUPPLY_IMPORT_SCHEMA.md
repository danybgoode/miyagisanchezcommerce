# Supply Import Schema Guide

This guide defines the canonical CSV/import shape for the Miyagi Sánchez supply acquisition workflow at `/supply?secret=...`.

The workflow stages external marketplace supply into `supply_batches` and `supply_items`, then imports approved rows into:

- `marketplace_shops`
- `marketplace_listings`

Imported shops are unclaimed, unverified, and marked as scraped supply.

## Canonical CSV Columns

Use this header row:

```csv
source_url,title,description,price,shop_name,location,state,municipio,image_url,category,listing_type,condition
```

## Required Fields

These fields must be present before a row can be imported successfully:

| CSV column | Meaning | Notes |
| --- | --- | --- |
| `source_url` | Original external listing URL | Required for duplicate detection and buyer provenance. Query/hash tracking is stripped for most sources. |
| `title` | Listing title | Required. Imported listing titles are capped to 100 chars. |
| `category` | Miyagi category key | Required. See allowed categories below. |
| `listing_type` | Listing type | Required. See allowed listing types below. |
| `shop_name` | External seller/shop name | Strongly required by policy/UX. If missing, backend can fall back to `Vendedor sin reclamar`, but import quality is worse. |

## Optional Fields

| CSV column | Meaning | Notes |
| --- | --- | --- |
| `description` | Listing description | Optional, but improves quality score and SEO. |
| `price` | Price in MXN pesos | Optional. Use normal pesos, e.g. `18500`, not centavos. |
| `location` | Human display location | Optional but recommended. |
| `state` | Mexican state | Optional if batch-level state is set. |
| `municipio` | City/municipio/alcaldia | Optional. |
| `image_url` | Primary image URL | Optional. |
| `condition` | Product condition | Optional. Only used for `product` listings. |

## Allowed Categories

Use the exact category keys:

```text
autos
inmuebles
electronica
hogar
moda
deportes
servicios
mascotas
herramientas
negocios
otros
```

## Allowed Listing Types

```text
product
service
rental
digital
```

Heuristics:

- Real estate normally uses `category=inmuebles`, `listing_type=product`.
- Cars normally use `category=autos`, `listing_type=product`.
- Google Local businesses normally use `listing_type=service`.
- Party equipment, venues, tools, gyms, and facilities may use `rental` or `service` depending on the offer.

## URL Handling

The importer stores the canonical URL in `source_url`.

Supported now:

- MercadoLibre item URLs containing `MLM-...`, including weird URLs from `auto.mercadolibre.com.mx`, `articulo.mercadolibre.com.mx`, or `mercadolibre.com.mx`.
- MercadoLibre item URL tracking after `?` or `#` is stripped automatically.
- Inmuebles24 individual listing URLs can be staged/imported if provided in CSV.
- Google Local keyword mode creates Google Maps source URLs automatically.

Not expanded yet:

- MercadoLibre seller/store URLs such as `vehiculos.mercadolibre.com.mx/_CustId_...`.
- MercadoLibre search result URLs.
- Inmuebles24 search result URLs.
- Apify actor URLs.

For those, run the external collector first and export rows into this CSV shape.

## Example Row

```csv
source_url,title,description,price,shop_name,location,state,municipio,image_url,category,listing_type,condition
https://auto.mercadolibre.com.mx/MLM-5229578222-nissan-kicks-2024-_JM,Nissan Kicks 2024,Auto publicado originalmente en MercadoLibre,,Vendedor MercadoLibre,Ciudad de México,Ciudad de México,,https://http2.mlstatic.com/D_NQ_NP_2X_000000-MLM00000000000_0000-F.webp,autos,product,good
```

## Direct Import Behavior

Direct CSV import does this:

1. Creates a `supply_batches` row.
2. Parses and normalizes CSV rows into `supply_items`.
3. Approves all staged rows in that batch.
4. Imports approved rows into live marketplace tables.
5. Marks each row as `imported`, `duplicate`, or `failed`.

Use direct import only for trusted, already-clean CSV files. For scraped/raw exports, prefer stage -> review -> import.

## Staging Quality Score

Rows get a simple quality score based on:

- title
- source URL
- shop name
- price
- image
- location
- description

The UI can bulk-approve good rows, but final import still validates required fields.

## Live API Endpoints

All supply endpoints require `x-admin-secret` or `?secret=`.

- `GET /api/supply/schema`
- `GET /api/supply/status`
- `GET /api/supply/batches`
- `POST /api/supply/batches`
- `GET /api/supply/items?batchId=...`
- `PATCH /api/supply/items`
- `POST /api/supply/import`

## Import Target Shape

Shop insert/upsert shape:

```ts
{
  slug,
  name,
  description,
  location,
  logo_url,
  clerk_user_id: null,
  source: 'scraped',
  source_url,
  verified: false,
  metadata: { supply: { batch_id, item_id, source_platform, unclaimed: true } }
}
```

Listing insert shape:

```ts
{
  shop_id,
  title,
  description,
  price_cents,
  currency: 'MXN',
  condition,
  listing_type,
  category,
  state,
  municipio,
  location,
  images,
  tags,
  status,
  source: 'scraped',
  source_platform,
  source_url,
  metadata: { original_source_url, supply: { batch_id, item_id, source_id, quality_score, unclaimed_shop: true } }
}
```
