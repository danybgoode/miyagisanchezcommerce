'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CATEGORIES } from '@/lib/types'
import { ESTADOS } from '@/lib/mx-locations'
import type { SupplyBatch, SupplyItem } from '@/lib/supply'
import { canonicalSourceUrl, ensureUrlProtocol } from '@/lib/url'

type SchemaCheck = { table: string; role: string; ok: boolean; error: string | null }
type ProviderStatus = {
  configured?: boolean
  ok?: boolean | null
  total_searches_left?: number | null
  plan_searches_left?: number | null
  searches_per_month?: number | null
  error?: string | null
  note?: string
}
type ParsedRow = Record<string, string | number | null>

const CSV_COLUMNS = [
  'source_url',
  'title',
  'description',
  'price',
  'shop_name',
  'location',
  'state',
  'municipio',
  'image_url',
  'category',
  'listing_type',
  'condition',
]

const TEMPLATE_CSV = `${CSV_COLUMNS.join(',')}
https://auto.mercadolibre.com.mx/MLM-5229578222-nissan-kicks-2024-_JM,Nissan Kicks 2024,Auto publicado originalmente en MercadoLibre,,Vendedor MercadoLibre,Ciudad de México,Ciudad de México,,https://http2.mlstatic.com/D_NQ_NP_2X_000000-MLM00000000000_0000-F.webp,autos,product,good
`

const SOURCE_HELP: Record<string, { label: string; description: string; recommended: string[] }> = {
  csv: {
    label: 'CSV',
    description: 'Best for controlled bulk import from Sheets, Apify dataset exports, or manually cleaned rows.',
    recommended: ['Any category'],
  },
  mercadolibre: {
    label: 'MercadoLibre',
    description: 'Currently supports individual item URLs or CSV rows. Seller/search URLs are not expanded here yet.',
    recommended: ['Autos', 'Hogar', 'Electrónica', 'Herramientas'],
  },
  inmuebles24: {
    label: 'Inmuebles24',
    description: 'Use CSV rows or individual listing URLs. Direct search pages are Cloudflare-protected and should come through Apify/export first.',
    recommended: ['Inmuebles'],
  },
  google_local: {
    label: 'Google Local',
    description: 'Runs SerpAPI keyword + geo search and stages local businesses as service listings.',
    recommended: ['Servicios', 'Negocios B2B', 'Deportes'],
  },
  apify: {
    label: 'Apify export',
    description: 'Paste actor dataset rows as CSV. Native actor launching is intentionally not connected yet.',
    recommended: ['Inmuebles', 'MercadoLibre categories'],
  },
  manual: {
    label: 'Manual',
    description: 'For hand-collected URLs or one-off rows that still need review before import.',
    recommended: ['Any category'],
  },
}

const MODE_HELP: Record<string, { label: string; description: string; supported: string[] }> = {
  csv: {
    label: 'CSV rows',
    description: 'Paste a header row plus rows. Required: source_url, title, shop_name or seller, category. Optional: price, description, location, image_url.',
    supported: ['csv', 'mercadolibre', 'inmuebles24', 'apify', 'manual'],
  },
  direct_urls: {
    label: 'Direct listing URLs',
    description: 'Paste one original listing URL per line. URL tracking is stripped. You will still review title/category/shop before import.',
    supported: ['mercadolibre', 'inmuebles24', 'manual'],
  },
  seller_urls: {
    label: 'Seller/store URLs',
    description: 'Accepted only as research seeds for now; this mode does not expand sellers into listings yet.',
    supported: ['mercadolibre', 'manual'],
  },
  search_url: {
    label: 'Search URL',
    description: 'Accepted as a seed/reference only; use Apify or CSV export to turn search results into rows.',
    supported: ['mercadolibre', 'inmuebles24', 'apify', 'manual'],
  },
  keyword_geo: {
    label: 'Keyword + geo',
    description: 'For Google Local only: enter a search term plus location and SerpAPI stages matching businesses.',
    supported: ['google_local'],
  },
}

const SOURCE_CATEGORY_HINTS: Record<string, string[]> = {
  inmuebles24: ['inmuebles'],
  google_local: ['servicios', 'negocios', 'deportes'],
}

// Shares the one canonicalizer in lib/url.ts (was a re-inlined copy that drifted
// its own scheme-predicate bug). `?? value.trim()` keeps the old empty-input shape.
function cleanUrlForDisplay(value: string) {
  return canonicalSourceUrl(value) ?? value.trim()
}

function parseCsvLine(line: string) {
  const cells: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const next = line[i + 1]
    if (char === '"' && quoted && next === '"') {
      cell += '"'
      i++
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell.trim())
  return cells
}

function titleFromUrl(url: string) {
  try {
    const parsed = new URL(cleanUrlForDisplay(url))
    const last = parsed.pathname.split('/').filter(Boolean).at(-1) ?? parsed.hostname
    return decodeURIComponent(last)
      .replace(/^MLM\s*\d+\s*/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .slice(0, 90)
  } catch {
    return ''
  }
}

function parseRows(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length === 0) return []

  const first = parseCsvLine(lines[0]).map(h => h.toLowerCase())
  const hasHeader = first.includes('source_url') || first.includes('title') || first.includes('shop_name')

  if (hasHeader) {
    return lines.slice(1).map(line => {
      const cells = parseCsvLine(line)
      const row: ParsedRow = {}
      first.forEach((key, index) => { row[key] = cells[index] ?? '' })
      return row
    })
  }

  return lines.map(line => {
    const url = cleanUrlForDisplay(line.trim())
    return {
      source_url: url,
      title: titleFromUrl(url),
      shop_name: new URL(ensureUrlProtocol(url) ?? `https://${url}`).hostname.replace(/^www\./, ''),
    }
  })
}

function toCsv(items: SupplyItem[]) {
  const header = CSV_COLUMNS.join(',')
  const rows = items.map(item => [
    item.source_url,
    item.listing_title,
    item.listing_description,
    item.price_cents ? String(item.price_cents / 100) : '',
    item.shop_name,
    item.location,
    item.state,
    item.municipio,
    item.images?.[0]?.url ?? '',
    item.category,
    item.listing_type,
    item.condition,
  ].map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
  return [header, ...rows].join('\n')
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function statusClass(status: string) {
  if (status === 'approved') return 'bg-emerald-50 text-emerald-800 border-emerald-200'
  if (status === 'imported') return 'bg-blue-50 text-blue-800 border-blue-200'
  if (status === 'rejected') return 'bg-zinc-100 text-zinc-700 border-zinc-200'
  if (status === 'failed') return 'bg-red-50 text-red-800 border-red-200'
  if (status === 'duplicate') return 'bg-amber-50 text-amber-800 border-amber-200'
  return 'bg-white text-zinc-700 border-zinc-200'
}

export default function SupplyClient({ secret }: { secret: string }) {
  const [schema, setSchema] = useState<{ ok: boolean; checks: SchemaCheck[] } | null>(null)
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [schemaCheckedAt, setSchemaCheckedAt] = useState<string | null>(null)
  const [providerStatus, setProviderStatus] = useState<Record<string, ProviderStatus> | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [batches, setBatches] = useState<SupplyBatch[]>([])
  const [activeBatchId, setActiveBatchId] = useState('')
  const [items, setItems] = useState<SupplyItem[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [csvFileName, setCsvFileName] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: `Supply batch ${new Date().toISOString().slice(0, 10)}`,
    source_platform: 'csv',
    source_mode: 'csv',
    category: 'inmuebles',
    listing_type: 'product',
    state: 'Ciudad de México',
    municipio: '',
    location: 'Ciudad de México',
    target_status: 'active',
    query: '',
    limit: '20',
    rows: CSV_COLUMNS.join(',') + '\n',
  })

  const activeBatch = useMemo(
    () => batches.find(batch => batch.id === activeBatchId) ?? null,
    [batches, activeBatchId],
  )

  const approvedCount = items.filter(item => item.status === 'approved').length
  const reviewableCount = items.filter(item => item.status === 'pending_review').length
  const importableCount = items.filter(item => item.status === 'approved' && item.source_url && item.listing_title && item.category).length
  const sourceHelp = SOURCE_HELP[form.source_platform] ?? SOURCE_HELP.manual
  const modeHelp = MODE_HELP[form.source_mode] ?? MODE_HELP.csv
  const availableModes = Object.entries(MODE_HELP).filter(([, mode]) => mode.supported.includes(form.source_platform))
  const categoryHints = SOURCE_CATEGORY_HINTS[form.source_platform]
  const categoryMismatch = Boolean(categoryHints && !categoryHints.includes(form.category))
  const keywordMode = form.source_platform === 'google_local' && form.source_mode === 'keyword_geo'
  const unsupportedMode = !modeHelp.supported.includes(form.source_platform)

  const api = useCallback((path: string, init?: RequestInit) => fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': secret,
      ...(init?.headers ?? {}),
    },
  }), [secret])

  const loadSchema = useCallback(async () => {
    setSchemaLoading(true)
    const res = await api(`/api/supply/schema?secret=${encodeURIComponent(secret)}`)
    if (res.ok) {
      setSchema(await res.json())
      setSchemaCheckedAt(new Date().toLocaleTimeString())
    }
    setSchemaLoading(false)
  }, [api, secret])

  const loadStatus = useCallback(async () => {
    setStatusLoading(true)
    const res = await api(`/api/supply/status?secret=${encodeURIComponent(secret)}`)
    const json = await res.json().catch(() => ({}))
    if (res.ok) setProviderStatus(json.providers ?? null)
    else setMessage(json.error ?? 'Could not load provider status')
    setStatusLoading(false)
  }, [api, secret])

  const loadBatches = useCallback(async () => {
    const res = await api(`/api/supply/batches?secret=${encodeURIComponent(secret)}`)
    const json = await res.json()
    if (res.ok) {
      setBatches(json.batches ?? [])
      if (!activeBatchId && json.batches?.[0]) setActiveBatchId(json.batches[0].id)
    } else {
      setMessage(json.error ?? 'Could not load batches')
    }
  }, [activeBatchId, api, secret])

  const loadItems = useCallback(async (batchId: string) => {
    if (!batchId) return
    const res = await api(`/api/supply/items?secret=${encodeURIComponent(secret)}&batchId=${encodeURIComponent(batchId)}`)
    const json = await res.json()
    if (res.ok) setItems(json.items ?? [])
    else setMessage(json.error ?? 'Could not load rows')
  }, [api, secret])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadSchema(); void loadStatus(); void loadBatches() }, [loadSchema, loadStatus, loadBatches])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadItems(activeBatchId) }, [activeBatchId, loadItems])

  async function createBatch() {
    setLoading(true)
    setMessage(null)
    const rows = keywordMode ? [] : parseRows(form.rows)
    try {
      const res = await api('/api/supply/batches', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          acquisition_settings: {
            created_from: 'supply_ui',
            row_count: rows.length,
            query: form.query,
            limit: Number(form.limit),
          },
          items: rows,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Batch creation failed')
      setActiveBatchId(json.batch.id)
      setMessage(`Created batch with ${json.inserted} staged row(s).`)
      await loadBatches()
      await loadItems(json.batch.id)
      if (keywordMode) await loadStatus()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleCsvFile(file: File | null) {
    if (!file) return
    const text = await file.text()
    setCsvFileName(file.name)
    setForm(f => ({
      ...f,
      source_platform: f.source_platform === 'google_local' ? 'csv' : f.source_platform,
      source_mode: 'csv',
      rows: text,
    }))
    setMessage(`Loaded ${file.name}. Review the rows or use Direct import CSV.`)
  }

  async function directImportCsv() {
    setLoading(true)
    setMessage(null)
    const rows = parseRows(form.rows)
    if (rows.length === 0) {
      setMessage('Upload or paste at least one CSV row before direct import.')
      setLoading(false)
      return
    }

    try {
      const batchRes = await api('/api/supply/batches', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          source_mode: 'csv',
          acquisition_settings: {
            created_from: 'supply_ui_direct_csv',
            row_count: rows.length,
            csv_file_name: csvFileName,
          },
          items: rows,
        }),
      })
      const batchJson = await batchRes.json()
      if (!batchRes.ok) throw new Error(batchJson.error ?? 'Batch creation failed')

      const batchId = batchJson.batch.id as string
      const itemRes = await api(`/api/supply/items?secret=${encodeURIComponent(secret)}&batchId=${encodeURIComponent(batchId)}`)
      const itemJson = await itemRes.json()
      if (!itemRes.ok) throw new Error(itemJson.error ?? 'Could not load staged CSV rows')

      const ids = (itemJson.items ?? []).map((item: SupplyItem) => item.id)
      if (ids.length === 0) throw new Error('No importable rows were staged from the CSV.')

      const approveRes = await api('/api/supply/items', {
        method: 'PATCH',
        body: JSON.stringify({ ids, patch: { status: 'approved' } }),
      })
      const approveJson = await approveRes.json()
      if (!approveRes.ok) throw new Error(approveJson.error ?? 'Could not approve CSV rows')

      const importRes = await api('/api/supply/import', {
        method: 'POST',
        body: JSON.stringify({ batchId, targetStatus: form.target_status }),
      })
      const importJson = await importRes.json()
      if (!importRes.ok) throw new Error(importJson.error ?? 'Import failed')

      setActiveBatchId(batchId)
      setMessage(`Direct CSV import finished: ${importJson.imported} imported, ${importJson.duplicate} duplicate(s), ${importJson.failed} failed.`)
      await loadBatches()
      await loadItems(batchId)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function patchItems(ids: string[], patch: Record<string, unknown>) {
    const res = await api('/api/supply/items', {
      method: 'PATCH',
      body: JSON.stringify({ ids, patch }),
    })
    const json = await res.json()
    if (!res.ok) {
      setMessage(json.error ?? 'Update failed')
      return
    }
    await loadItems(activeBatchId)
    await loadBatches()
  }

  async function importBatch() {
    if (!activeBatchId) return
    setLoading(true)
    setMessage(null)
    try {
      const res = await api('/api/supply/import', {
        method: 'POST',
        body: JSON.stringify({ batchId: activeBatchId, targetStatus: activeBatch?.target_status ?? 'active' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Import failed')
      setMessage(`Imported ${json.imported}, skipped ${json.duplicate} duplicate(s), failed ${json.failed}.`)
      await loadItems(activeBatchId)
      await loadBatches()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--surface-supply)]">
      <div className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Hidden admin workflow</p>
            <h1 className="text-2xl font-bold text-zinc-950">Supply Acquisition</h1>
          </div>
          <div className="ml-auto flex items-center gap-2 text-sm text-zinc-600">
            <Link href={`/admin?secret=${encodeURIComponent(secret)}`} className="rounded border border-zinc-300 px-3 py-1.5 no-underline hover:bg-zinc-50">
              Old scraper
            </Link>
            <Link href="/l" className="rounded border border-zinc-300 px-3 py-1.5 no-underline hover:bg-zinc-50">
              Marketplace
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-4">
          <section className="rounded-md border border-zinc-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-950">Schema</h2>
              <button onClick={() => void loadSchema()} className="rounded border border-zinc-300 px-2 py-1 text-xs">
                {schemaLoading ? 'Checking...' : 'Check'}
              </button>
            </div>
            {!schema ? (
              <p className="text-sm text-zinc-500">Checking target tables...</p>
            ) : (
              <div className="space-y-2">
                <div className={`rounded border px-2 py-1.5 text-xs font-semibold ${schema.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
                  {schema.ok ? 'Ready to stage and import' : 'Schema needs attention'}
                  {schemaCheckedAt && <span className="ml-1 font-normal">checked {schemaCheckedAt}</span>}
                </div>
                {schema.checks.map(check => (
                  <div key={check.table} className="flex gap-2 text-xs">
                    <span className={check.ok ? 'text-emerald-700' : 'text-red-700'}>{check.ok ? 'OK' : 'Missing'}</span>
                    <div>
                      <div className="font-medium text-zinc-900">{check.table}</div>
                      <div className="text-zinc-500">{check.error ?? check.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-md border border-zinc-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-950">Provider Tanks</h2>
              <button onClick={() => void loadStatus()} className="rounded border border-zinc-300 px-2 py-1 text-xs">
                {statusLoading ? 'Checking...' : 'Refresh'}
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="rounded border border-zinc-200 p-2">
                <div className="flex items-center justify-between font-semibold text-zinc-900">
                  <span>SerpAPI</span>
                  <span className={providerStatus?.serpapi?.ok ? 'text-emerald-700' : 'text-zinc-500'}>
                    {providerStatus?.serpapi?.configured ? providerStatus.serpapi.ok ? 'OK' : 'Check failed' : 'Not configured'}
                  </span>
                </div>
                <div className="mt-1 text-zinc-500">
                  {providerStatus?.serpapi?.total_searches_left != null
                    ? `${providerStatus.serpapi.total_searches_left} total searches left`
                    : providerStatus?.serpapi?.error ?? 'Used by Google Local keyword search.'}
                </div>
              </div>
              <div className="rounded border border-zinc-200 p-2">
                <div className="flex items-center justify-between font-semibold text-zinc-900">
                  <span>Apify</span>
                  <span className={providerStatus?.apify?.configured ? 'text-emerald-700' : 'text-zinc-500'}>
                    {providerStatus?.apify?.configured ? 'Token present' : 'No token'}
                  </span>
                </div>
                <div className="mt-1 text-zinc-500">{providerStatus?.apify?.note ?? 'Paste exported CSV rows for now.'}</div>
              </div>
            </div>
          </section>

          <section className="rounded-md border border-zinc-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-bold text-zinc-950">1. Collect</h2>
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-zinc-600">
                Batch name
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mt-1 w-full rounded border border-zinc-300 px-2 py-2 text-sm" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-semibold text-zinc-600">
                  Source <span className="text-red-700">*</span>
                  <select
                    value={form.source_platform}
                    onChange={e => {
                      const nextSource = e.target.value
                      const nextMode = Object.entries(MODE_HELP).find(([, mode]) => mode.supported.includes(nextSource))?.[0] ?? 'csv'
                      setForm(f => ({
                        ...f,
                        source_platform: nextSource,
                        source_mode: MODE_HELP[f.source_mode]?.supported.includes(nextSource) ? f.source_mode : nextMode,
                        category: nextSource === 'inmuebles24' ? 'inmuebles' : nextSource === 'google_local' ? 'servicios' : f.category,
                        listing_type: nextSource === 'google_local' ? 'service' : f.listing_type,
                      }))
                    }}
                    className="mt-1 w-full rounded border border-zinc-300 px-2 py-2 text-sm"
                  >
                    {Object.entries(SOURCE_HELP).map(([key, info]) => <option key={key} value={key}>{info.label}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-semibold text-zinc-600">
                  Mode <span className="text-red-700">*</span>
                  <select value={form.source_mode} onChange={e => setForm(f => ({ ...f, source_mode: e.target.value }))} className="mt-1 w-full rounded border border-zinc-300 px-2 py-2 text-sm">
                    {availableModes.map(([key, mode]) => <option key={key} value={key}>{mode.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="rounded border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
                <div className="font-semibold text-zinc-900">{sourceHelp.label}</div>
                <p className="mt-1">{sourceHelp.description}</p>
                <p className="mt-1"><span className="font-semibold">Mode:</span> {modeHelp.description}</p>
                <p className="mt-1"><span className="font-semibold">Good for:</span> {sourceHelp.recommended.join(', ')}</p>
              </div>
              {categoryMismatch && (
                <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                  This source usually maps to {categoryHints?.join(', ')}. You can continue, but review category carefully before import.
                </div>
              )}
              {unsupportedMode && (
                <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                  This source/mode combination is not supported. Pick one of the modes listed for this source.
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-semibold text-zinc-600">
                  Category <span className="text-red-700">*</span>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="mt-1 w-full rounded border border-zinc-300 px-2 py-2 text-sm">
                    {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-semibold text-zinc-600">
                  Listing type <span className="text-red-700">*</span>
                  <select value={form.listing_type} onChange={e => setForm(f => ({ ...f, listing_type: e.target.value }))} className="mt-1 w-full rounded border border-zinc-300 px-2 py-2 text-sm">
                    {['product', 'service', 'rental', 'digital'].map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
              </div>
              <label className="block text-xs font-semibold text-zinc-600">
                Estado / State <span className="text-red-700">*</span>
                <select value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value, municipio: '' }))} className="mt-1 w-full rounded border border-zinc-300 px-2 py-2 text-sm">
                  <option value="">Selecciona estado</option>
                  {ESTADOS.map(e => <option key={e.inegi_code} value={e.name}>{e.name}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-semibold text-zinc-600">
                  Municipio / Municipality
                  <input value={form.municipio} onChange={e => setForm(f => ({ ...f, municipio: e.target.value }))} className="mt-1 w-full rounded border border-zinc-300 px-2 py-2 text-sm" />
                </label>
                <label className="block text-xs font-semibold text-zinc-600">
                  Status after import <span className="text-red-700">*</span>
                  <select value={form.target_status} onChange={e => setForm(f => ({ ...f, target_status: e.target.value }))} className="mt-1 w-full rounded border border-zinc-300 px-2 py-2 text-sm">
                    <option value="active">active</option>
                    <option value="pending_review">pending_review</option>
                  </select>
                </label>
              </div>
              {keywordMode ? (
                <div className="grid grid-cols-[1fr_88px] gap-2">
                  <label className="block text-xs font-semibold text-zinc-600">
                    Search term <span className="text-red-700">*</span>
                    <input value={form.query} onChange={e => setForm(f => ({ ...f, query: e.target.value }))} className="mt-1 w-full rounded border border-zinc-300 px-2 py-2 text-sm" placeholder="taller mecánico, renta de sillas, gimnasio" />
                  </label>
                  <label className="block text-xs font-semibold text-zinc-600">
                    Limit
                    <input value={form.limit} onChange={e => setForm(f => ({ ...f, limit: e.target.value }))} className="mt-1 w-full rounded border border-zinc-300 px-2 py-2 text-sm" type="number" min={1} max={40} />
                  </label>
                  <p className="col-span-2 text-xs text-zinc-500">
                    Location comes from the state/municipio/location fields above. Each run consumes SerpAPI search credits.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-zinc-600">
                    CSV file upload
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={e => { void handleCsvFile(e.target.files?.[0] ?? null) }}
                      className="mt-1 w-full rounded border border-zinc-300 px-2 py-2 text-sm"
                    />
                    {csvFileName && <span className="mt-1 block text-xs font-normal text-zinc-500">Loaded: {csvFileName}</span>}
                  </label>
                  <label className="block text-xs font-semibold text-zinc-600">
                    {form.source_mode === 'direct_urls' ? 'Original listing URLs' : 'CSV rows or source URLs'} <span className="text-red-700">*</span>
                    <textarea value={form.rows} onChange={e => setForm(f => ({ ...f, rows: e.target.value }))} rows={9} className="mt-1 w-full rounded border border-zinc-300 px-2 py-2 font-mono text-xs" />
                    <span className="mt-1 block text-xs font-normal text-zinc-500">
                      Direct ML item URL example: https://auto.mercadolibre.com.mx/MLM-5229578222-nissan-kicks-2024-_JM. Tracking after ? or # is stripped automatically.
                    </span>
                  </label>
                </div>
              )}
              <div className="rounded border border-zinc-200 p-2 text-xs text-zinc-600">
                Required before import: original source URL, title, category, listing type, and shop name. Optional: price, description, image, condition, municipio.
              </div>
              <div className="flex gap-2">
                <button onClick={createBatch} disabled={loading || schema?.ok === false || unsupportedMode || (keywordMode && !form.query.trim())} className="rounded bg-zinc-950 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-400">
                  {keywordMode ? 'Run search' : 'Stage rows'}
                </button>
                {!keywordMode && (
                  <button onClick={() => void directImportCsv()} disabled={loading || schema?.ok === false || unsupportedMode} className="rounded border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-40">
                    Direct import CSV
                  </button>
                )}
                <button onClick={() => downloadCsv('supply-import-template.csv', TEMPLATE_CSV)} className="rounded border border-zinc-300 px-3 py-2 text-sm">
                  Download template
                </button>
                <button onClick={() => setForm(f => ({ ...f, rows: CSV_COLUMNS.join(',') + '\n' }))} className="rounded border border-zinc-300 px-3 py-2 text-sm">
                  Empty template
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-md border border-zinc-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-bold text-zinc-950">Batches</h2>
            <div className="max-h-80 space-y-2 overflow-auto">
              {batches.map(batch => (
                <button
                  key={batch.id}
                  onClick={() => setActiveBatchId(batch.id)}
                  className={`w-full rounded border px-3 py-2 text-left text-sm ${batch.id === activeBatchId ? 'border-zinc-950 bg-zinc-50' : 'border-zinc-200 bg-white'}`}
                >
                  <div className="font-semibold text-zinc-950">{batch.name}</div>
                  <div className="text-xs text-zinc-500">{batch.source_platform} · {batch.total_count} rows · {batch.status}</div>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <main className="space-y-4">
          {message && (
            <div className="rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-800">
              {message}
            </div>
          )}

          <section className="rounded-md border border-zinc-200 bg-white">
            <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3">
              <div>
                <h2 className="text-sm font-bold text-zinc-950">2. Review and Clean</h2>
                <p className="text-xs text-zinc-500">{activeBatch ? activeBatch.name : 'Select or create a batch'}</p>
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <button onClick={() => void patchItems(items.filter(i => i.status === 'pending_review' && i.quality_score >= 5).map(i => i.id), { status: 'approved' })} disabled={!reviewableCount} className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40">
                  Approve good rows
                </button>
                <button onClick={() => downloadCsv(`supply-${activeBatchId || 'batch'}.csv`, toCsv(items))} disabled={!items.length} className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40">
                  Download CSV
                </button>
              </div>
            </div>

            <div className="grid grid-cols-4 border-b border-zinc-200 text-center text-sm">
              <div className="p-3"><div className="text-lg font-bold">{items.length}</div><div className="text-xs text-zinc-500">staged</div></div>
              <div className="p-3"><div className="text-lg font-bold">{approvedCount}</div><div className="text-xs text-zinc-500">approved</div></div>
              <div className="p-3"><div className="text-lg font-bold">{importableCount}</div><div className="text-xs text-zinc-500">importable</div></div>
              <div className="p-3"><div className="text-lg font-bold">{items.filter(i => i.status === 'failed').length}</div><div className="text-xs text-zinc-500">failed</div></div>
            </div>

            <div className="overflow-auto">
              <table className="w-full min-w-[980px] border-collapse text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Listing</th>
                    <th className="px-3 py-2">Seller</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Price</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} className="border-t border-zinc-100 align-top">
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded border px-2 py-1 text-xs font-semibold ${statusClass(item.status)}`}>
                          {item.status}
                        </span>
                        <div className="mt-2 text-xs text-zinc-500">Q{item.quality_score}/9</div>
                        {item.error_message && <div className="mt-1 max-w-36 text-xs text-red-700">{item.error_message}</div>}
                      </td>
                      <td className="px-3 py-3">
                        <input
                          defaultValue={item.listing_title ?? ''}
                          onBlur={e => void patchItems([item.id], { listing_title: e.target.value })}
                          className="w-full rounded border border-zinc-300 px-2 py-1.5 font-medium"
                        />
                        <textarea
                          defaultValue={item.listing_description ?? ''}
                          onBlur={e => void patchItems([item.id], { listing_description: e.target.value })}
                          rows={2}
                          className="mt-2 w-full rounded border border-zinc-300 px-2 py-1.5 text-xs"
                          placeholder="Description"
                        />
                        <input
                          defaultValue={item.location ?? ''}
                          onBlur={e => void patchItems([item.id], { location: e.target.value })}
                          className="mt-2 w-full rounded border border-zinc-300 px-2 py-1.5 text-xs"
                          placeholder="Location"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <input
                          defaultValue={item.shop_name ?? ''}
                          onBlur={e => void patchItems([item.id], { shop_name: e.target.value })}
                          className="w-full rounded border border-zinc-300 px-2 py-1.5"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <select
                          value={item.category ?? ''}
                          onChange={e => void patchItems([item.id], { category: e.target.value })}
                          className="w-full rounded border border-zinc-300 px-2 py-1.5"
                        >
                          <option value="">Missing</option>
                          {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>
                        <select
                          value={item.listing_type}
                          onChange={e => void patchItems([item.id], { listing_type: e.target.value })}
                          className="mt-2 w-full rounded border border-zinc-300 px-2 py-1.5"
                        >
                          {['product', 'service', 'rental', 'digital'].map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-3">
                        <input
                          defaultValue={item.price_cents ? String(item.price_cents / 100) : ''}
                          onBlur={e => void patchItems([item.id], { price_cents: e.target.value })}
                          className="w-28 rounded border border-zinc-300 px-2 py-1.5"
                          placeholder="MXN"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <input
                          defaultValue={item.source_url ?? ''}
                          onBlur={e => void patchItems([item.id], { source_url: e.target.value })}
                          className="w-full rounded border border-zinc-300 px-2 py-1.5 text-xs"
                        />
                        {item.source_url && <a href={item.source_url} target="_blank" className="mt-2 block text-xs" rel="noreferrer">Open original</a>}
                        {item.imported_listing_id && <a href={`/l/${item.imported_listing_id}`} target="_blank" className="mt-1 block text-xs" rel="noreferrer">View imported</a>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-2">
                          <button onClick={() => void patchItems([item.id], { status: 'approved' })} className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-800">
                            Approve
                          </button>
                          <button onClick={() => void patchItems([item.id], { status: 'rejected' })} className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700">
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-sm text-zinc-500">
                        No staged rows yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-md border border-zinc-200 bg-white p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div>
                <h2 className="text-sm font-bold text-zinc-950">3. Import</h2>
                <p className="text-xs text-zinc-500">Only approved rows with title, category, and original URL are imported into unclaimed scraped shops. For trusted CSV files, use Direct import CSV in Step 1.</p>
              </div>
              <div className="ml-auto flex max-w-xl flex-wrap items-center justify-end gap-2">
                <label className="min-w-56 text-xs font-semibold text-zinc-600">
                  Direct CSV file
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={e => { void handleCsvFile(e.target.files?.[0] ?? null) }}
                    className="mt-1 w-full rounded border border-zinc-300 px-2 py-2 text-sm"
                  />
                </label>
                <button onClick={() => void directImportCsv()} disabled={loading || schema?.ok === false || keywordMode || unsupportedMode} className="rounded border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-40">
                  Direct import CSV
                </button>
                <button onClick={importBatch} disabled={loading || importableCount === 0} className="rounded bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-400">
                  Import approved rows
                </button>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
