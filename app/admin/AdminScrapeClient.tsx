'use client'

import { useState, useEffect, useCallback } from 'react'
import { CATEGORIES } from '@/lib/types'

interface ScrapeRun {
  id: string
  source: string
  params: Record<string, unknown>
  status: 'running' | 'completed' | 'failed'
  count_inserted: number
  count_skipped: number
  count_errors: number
  error_message: string | null
  started_at: string
  completed_at: string | null
}

interface RunResult {
  inserted?: number
  skipped?: number
  errors?: number
  error?: string
  runId?: string
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: 'background-color:#fef08a;color:#713f12',
    completed: 'background-color:#bbf7d0;color:#14532d',
    failed: 'background-color:#fecaca;color:#7f1d1d',
  }
  const style = colors[status] ?? 'background-color:#e5e7eb;color:#374151'
  return (
    <span
      style={{ ...Object.fromEntries(style.split(';').map(s => { const [k, v] = s.split(':'); return [k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v] })), padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}
    >
      {status}
    </span>
  )
}

interface SerpApiFormState {
  query: string
  location: string
  state: string
  category: string
  limit: string
}

interface MLFormState {
  query: string
  category: string
  limit: string
}

export default function AdminScrapeClient({ secret }: { secret: string }) {
  const [runs, setRuns] = useState<ScrapeRun[]>([])
  const [serpForm, setSerpForm] = useState<SerpApiFormState>({
    query: '',
    location: 'Ciudad de México, Mexico',
    state: 'Ciudad de México',
    category: 'servicios',
    limit: '20',
  })
  const [mlForm, setMlForm] = useState<MLFormState>({
    query: '',
    category: 'electronica',
    limit: '20',
  })
  const [serpLoading, setSerpLoading] = useState(false)
  const [mlLoading, setMlLoading] = useState(false)
  const [serpResult, setSerpResult] = useState<RunResult | null>(null)
  const [mlResult, setMlResult] = useState<RunResult | null>(null)

  const fetchRuns = useCallback(async () => {
    const res = await fetch(`/api/admin/runs?secret=${encodeURIComponent(secret)}`)
    if (res.ok) {
      const json = await res.json() as { runs: ScrapeRun[] }
      setRuns(json.runs)
    }
  }, [secret])

  useEffect(() => {
    void fetchRuns()
  }, [fetchRuns])

  async function runSerpApi(e: React.FormEvent) {
    e.preventDefault()
    setSerpLoading(true)
    setSerpResult(null)
    try {
      const res = await fetch('/api/admin/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': secret,
        },
        body: JSON.stringify({
          source: 'serpapi_google_local',
          params: {
            query: serpForm.query,
            location: serpForm.location,
            state: serpForm.state,
            category: serpForm.category,
            limit: Number(serpForm.limit),
          },
        }),
      })
      const json = await res.json() as RunResult
      setSerpResult(json)
      await fetchRuns()
    } catch (err) {
      setSerpResult({ error: String(err) })
    } finally {
      setSerpLoading(false)
    }
  }

  async function runML(e: React.FormEvent) {
    e.preventDefault()
    setMlLoading(true)
    setMlResult(null)
    try {
      const res = await fetch('/api/admin/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': secret,
        },
        body: JSON.stringify({
          source: 'mercadolibre_public',
          params: {
            query: mlForm.query,
            category: mlForm.category,
            limit: Number(mlForm.limit),
          },
        }),
      })
      const json = await res.json() as RunResult
      setMlResult(json)
      await fetchRuns()
    } catch (err) {
      setMlResult({ error: String(err) })
    } finally {
      setMlLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: 14,
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#374151' }
  const fieldStyle: React.CSSProperties = { marginBottom: 14 }
  const btnStyle: React.CSSProperties = {
    backgroundColor: '#3a8a7a',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '9px 22px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  }
  const cardStyle: React.CSSProperties = {
    backgroundColor: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: 24,
    marginBottom: 24,
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb', fontFamily: 'system-ui, sans-serif' }}>
      {/* Nav */}
      <div style={{ backgroundColor: '#1f2937', color: '#fff', padding: '14px 28px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.5px' }}>miyagisanchez</span>
        <span style={{ color: '#9ca3af', fontSize: 14 }}>ADMIN</span>
      </div>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px' }}>
        {/* SerpAPI section */}
        <div style={cardStyle}>
          <h2 style={{ margin: '0 0 18px', fontSize: 16, fontWeight: 700 }}>SerpAPI — Google Local</h2>
          <form onSubmit={(e) => { void runSerpApi(e) }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Query</label>
                <input style={inputStyle} value={serpForm.query} onChange={e => setSerpForm(f => ({ ...f, query: e.target.value }))} placeholder="taller mecánico" required />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Location</label>
                <input style={inputStyle} value={serpForm.location} onChange={e => setSerpForm(f => ({ ...f, location: e.target.value }))} />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>State</label>
                <input style={inputStyle} value={serpForm.state} onChange={e => setSerpForm(f => ({ ...f, state: e.target.value }))} placeholder="Ciudad de México" />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Category</label>
                <select style={inputStyle} value={serpForm.category} onChange={e => setSerpForm(f => ({ ...f, category: e.target.value }))}>
                  {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Limit</label>
                <input style={inputStyle} type="number" min={1} max={50} value={serpForm.limit} onChange={e => setSerpForm(f => ({ ...f, limit: e.target.value }))} />
              </div>
            </div>
            <button type="submit" style={btnStyle} disabled={serpLoading}>
              {serpLoading && <Spinner />}
              {serpLoading ? 'Running…' : 'Run Scrape'}
            </button>
          </form>
          {serpResult && (
            <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 6, backgroundColor: serpResult.error ? '#fef2f2' : '#f0fdf4', border: `1px solid ${serpResult.error ? '#fca5a5' : '#86efac'}`, fontSize: 14 }}>
              {serpResult.error
                ? <span style={{ color: '#dc2626' }}>Error: {serpResult.error}</span>
                : <span style={{ color: '#16a34a' }}>Inserted: {serpResult.inserted} | Skipped: {serpResult.skipped} | Errors: {serpResult.errors}</span>
              }
            </div>
          )}
        </div>

        {/* MercadoLibre section */}
        <div style={cardStyle}>
          <h2 style={{ margin: '0 0 18px', fontSize: 16, fontWeight: 700 }}>MercadoLibre Catalog</h2>
          <form onSubmit={(e) => { void runML(e) }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Query</label>
                <input style={inputStyle} value={mlForm.query} onChange={e => setMlForm(f => ({ ...f, query: e.target.value }))} placeholder="laptop" required />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Category</label>
                <select style={inputStyle} value={mlForm.category} onChange={e => setMlForm(f => ({ ...f, category: e.target.value }))}>
                  {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Limit</label>
                <input style={inputStyle} type="number" min={1} max={50} value={mlForm.limit} onChange={e => setMlForm(f => ({ ...f, limit: e.target.value }))} />
              </div>
            </div>
            <button type="submit" style={btnStyle} disabled={mlLoading}>
              {mlLoading && <Spinner />}
              {mlLoading ? 'Running…' : 'Run Scrape'}
            </button>
          </form>
          {mlResult && (
            <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 6, backgroundColor: mlResult.error ? '#fef2f2' : '#f0fdf4', border: `1px solid ${mlResult.error ? '#fca5a5' : '#86efac'}`, fontSize: 14 }}>
              {mlResult.error
                ? <span style={{ color: '#dc2626' }}>Error: {mlResult.error}</span>
                : <span style={{ color: '#16a34a' }}>Inserted: {mlResult.inserted} | Skipped: {mlResult.skipped} | Errors: {mlResult.errors}</span>
              }
            </div>
          )}
        </div>

        {/* Runs history */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Recent Runs</h2>
            <button onClick={() => { void fetchRuns() }} style={{ ...btnStyle, padding: '6px 14px', fontSize: 13 }}>Refresh</button>
          </div>
          {runs.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: 14 }}>No runs yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                    {['Source', 'Params', 'Status', 'Inserted', 'Skipped', 'Errors', 'Started'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: '#6b7280', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runs.map(run => (
                    <tr key={run.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 500 }}>{run.source.replace('_', ' ')}</td>
                      <td style={{ padding: '8px 10px', color: '#6b7280', maxWidth: 160 }}>
                        <span title={JSON.stringify(run.params)} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                          {run.params.query ? `"${run.params.query}"` : JSON.stringify(run.params)}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px' }}><StatusBadge status={run.status} /></td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>{run.count_inserted}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>{run.count_skipped}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>{run.count_errors}</td>
                      <td style={{ padding: '8px 10px', color: '#9ca3af' }}>{timeAgo(run.started_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" style={{ animation: 'spin 0.8s linear infinite' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <circle cx="8" cy="8" r="6" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" />
      <path d="M8 2 A6 6 0 0 1 14 8" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
