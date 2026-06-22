'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { Dictionary } from '@/lib/dictionary'
import type { SweepstakesCampaign, SweepstakesSettings, SweepstakesStats } from '@/lib/sweepstakes-types'

type SellerUi = Dictionary['sweepstakes']['seller']
type CampaignWithStats = SweepstakesCampaign & { stats: SweepstakesStats }

type FormState = {
  id?: string
  title_es: string
  title_en: string
  prize_description_es: string
  prize_description_en: string
  prize_image_url: string
  terms_es: string
  terms_en: string
  starts_at: string
  ends_at: string
  free_ticket_value: string
  purchase_bonus_enabled: boolean
  purchase_ticket_value: string
  organizer_name: string
  organizer_contact: string
  permit_reference: string
  attested: boolean
}

const emptyForm: FormState = {
  title_es: '',
  title_en: '',
  prize_description_es: '',
  prize_description_en: '',
  prize_image_url: '',
  terms_es: '',
  terms_en: '',
  starts_at: '',
  ends_at: '',
  free_ticket_value: '1',
  purchase_bonus_enabled: false,
  purchase_ticket_value: '5',
  organizer_name: '',
  organizer_contact: '',
  permit_reference: '',
  attested: false,
}

function toInputDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const offset = d.getTimezoneOffset()
  const local = new Date(d.getTime() - offset * 60000)
  return local.toISOString().slice(0, 16)
}

function fromInputDate(value: string): string | null {
  if (!value) return null
  return new Date(value).toISOString()
}

function formFromCampaign(c: CampaignWithStats): FormState {
  return {
    id: c.id,
    title_es: c.title_es ?? '',
    title_en: c.title_en ?? '',
    prize_description_es: c.prize_description_es ?? '',
    prize_description_en: c.prize_description_en ?? '',
    prize_image_url: c.prize_image_url ?? '',
    terms_es: c.terms_es ?? '',
    terms_en: c.terms_en ?? '',
    starts_at: toInputDate(c.starts_at),
    ends_at: toInputDate(c.ends_at),
    free_ticket_value: String(c.free_ticket_value ?? 1),
    purchase_bonus_enabled: c.purchase_bonus_enabled === true,
    purchase_ticket_value: String(c.purchase_ticket_value ?? 5),
    organizer_name: c.organizer_name ?? '',
    organizer_contact: c.organizer_contact ?? '',
    permit_reference: c.permit_reference ?? '',
    attested: !!c.compliance_attested_at,
  }
}

function statusLabel(ui: SellerUi, status: string) {
  if (status === 'draft') return ui.statusDraft
  if (status === 'scheduled') return ui.statusScheduled
  if (status === 'active') return ui.statusActive
  if (status === 'completed') return ui.statusCompleted
  if (status === 'cancelled') return ui.statusCancelled
  return status
}

export default function SweepstakesManager({
  ui,
  initialCampaigns,
  settings,
}: {
  ui: SellerUi
  initialCampaigns: CampaignWithStats[]
  settings: SweepstakesSettings
}) {
  const [campaigns, setCampaigns] = useState<CampaignWithStats[]>(initialCampaigns)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [publishingId, setPublishingId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [broadcast, setBroadcast] = useState<Record<string, { es: string; en: string; coupon: string; sending: boolean }>>({})

  const editing = !!form.id
  const canPublish = settings.enabled

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function payload() {
    return {
      title_es: form.title_es,
      title_en: form.title_en,
      prize_description_es: form.prize_description_es,
      prize_description_en: form.prize_description_en,
      prize_image_url: form.prize_image_url || null,
      terms_es: form.terms_es,
      terms_en: form.terms_en,
      starts_at: fromInputDate(form.starts_at),
      ends_at: fromInputDate(form.ends_at),
      free_ticket_value: Number(form.free_ticket_value) || 1,
      purchase_bonus_enabled: form.purchase_bonus_enabled,
      purchase_ticket_value: Number(form.purchase_ticket_value) || 5,
      organizer_name: form.organizer_name,
      organizer_contact: form.organizer_contact,
      permit_reference: form.permit_reference,
    }
  }

  async function reload() {
    const res = await fetch('/api/sell/sweepstakes')
    const data = await res.json() as { campaigns?: CampaignWithStats[] }
    setCampaigns(data.campaigns ?? [])
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null); setMessage(null)
    try {
      const res = await fetch(form.id ? `/api/sell/sweepstakes/${form.id}` : '/api/sell/sweepstakes', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      })
      const data = await res.json() as { campaign?: CampaignWithStats; error?: string }
      if (!res.ok || !data.campaign) { setError(data.error ?? ui.error); return }
      setMessage(ui.saved)
      setForm(formFromCampaign(data.campaign))
      await reload()
    } catch {
      setError(ui.error)
    } finally {
      setSaving(false)
    }
  }

  async function publish(campaign: CampaignWithStats) {
    setPublishingId(campaign.id); setError(null); setMessage(null)
    try {
      const res = await fetch(`/api/sell/sweepstakes/${campaign.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attested: form.id === campaign.id ? form.attested : !!campaign.compliance_attested_at }),
      })
      const data = await res.json() as { error?: string; missing?: string[] }
      if (!res.ok) {
        setError(data.error === 'publish_gate' ? `${ui.error} ${data.missing?.join(', ') ?? ''}` : data.error ?? ui.error)
        return
      }
      setMessage(ui.published)
      await reload()
    } catch {
      setError(ui.error)
    } finally {
      setPublishingId(null)
    }
  }

  async function upload(file: File | null) {
    if (!file) return
    setUploading(true); setError(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/sell/upload', { method: 'POST', body: fd })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) { setError(data.error ?? ui.error); return }
      set('prize_image_url', data.url)
    } catch {
      setError(ui.error)
    } finally {
      setUploading(false)
    }
  }

  async function copyPublic(slug: string) {
    const href = `${window.location.origin}/g/${slug}`
    await navigator.clipboard.writeText(href)
  }

  async function sendConsolation(campaign: CampaignWithStats) {
    const state = broadcast[campaign.id] ?? { es: '', en: '', coupon: '', sending: false }
    setBroadcast(prev => ({ ...prev, [campaign.id]: { ...state, sending: true } }))
    setError(null); setMessage(null)
    try {
      const res = await fetch(`/api/sell/sweepstakes/${campaign.id}/consolation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_es: state.es, message_en: state.en, coupon_code: state.coupon || null }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) { setError(data.error ?? ui.error); return }
      setMessage(ui.sentConsolation)
      await reload()
    } catch {
      setError(ui.error)
    } finally {
      setBroadcast(prev => ({ ...prev, [campaign.id]: { ...(prev[campaign.id] ?? state), sending: false } }))
    }
  }

  const selectedCampaign = useMemo(
    () => form.id ? campaigns.find(c => c.id === form.id) : null,
    [campaigns, form.id],
  )

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">{ui.title}</h1>
          <p className="text-sm text-[var(--color-muted)] mt-1">{ui.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => { setForm(emptyForm); setMessage(null); setError(null) }}
          className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm font-semibold"
        >
          {ui.newCampaign}
        </button>
      </div>

      {!settings.enabled && (
        <p className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {ui.killSwitch}
        </p>
      )}
      <p className="mb-5 rounded-lg border border-[var(--color-border)] px-4 py-3 text-sm text-[var(--color-muted)]">
        {ui.legalNote}
      </p>

      {message && <p className="mb-4 text-sm text-green-700">{message}</p>}
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_0.95fr] gap-6">
        <form onSubmit={save} className="border border-[var(--color-border)] rounded-xl p-5">
          <h2 className="font-semibold mb-4">{editing ? statusLabel(ui, selectedCampaign?.status ?? '') : ui.newCampaign}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block text-sm font-medium">
              {ui.titleEs}
              <input value={form.title_es} onChange={e => set('title_es', e.target.value)} className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)]" />
            </label>
            <label className="block text-sm font-medium">
              {ui.titleEn}
              <input value={form.title_en} onChange={e => set('title_en', e.target.value)} className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)]" />
            </label>
            <label className="block text-sm font-medium sm:col-span-2">
              {ui.descriptionEs}
              <textarea value={form.prize_description_es} onChange={e => set('prize_description_es', e.target.value)} rows={3} className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)]" />
            </label>
            <label className="block text-sm font-medium sm:col-span-2">
              {ui.descriptionEn}
              <textarea value={form.prize_description_en} onChange={e => set('prize_description_en', e.target.value)} rows={3} className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)]" />
            </label>
            <label className="block text-sm font-medium">
              {ui.start}
              <input type="datetime-local" value={form.starts_at} onChange={e => set('starts_at', e.target.value)} className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)]" />
            </label>
            <label className="block text-sm font-medium">
              {ui.end}
              <input type="datetime-local" value={form.ends_at} onChange={e => set('ends_at', e.target.value)} className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)]" />
            </label>
            <label className="block text-sm font-medium">
              {ui.freeTickets}
              <input type="number" min="1" value={form.free_ticket_value} onChange={e => set('free_ticket_value', e.target.value)} className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)]" />
            </label>
            <label className="block text-sm font-medium">
              {ui.purchaseTickets}
              <input type="number" min="1" disabled={!form.purchase_bonus_enabled} value={form.purchase_ticket_value} onChange={e => set('purchase_ticket_value', e.target.value)} className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)] disabled:opacity-50" />
            </label>
            <label className="sm:col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.purchase_bonus_enabled} onChange={e => set('purchase_bonus_enabled', e.target.checked)} />
              {ui.purchaseBonus}
            </label>
            <label className="block text-sm font-medium sm:col-span-2">
              {ui.prizeImage}
              <div className="mt-1 flex gap-2">
                <input value={form.prize_image_url} onChange={e => set('prize_image_url', e.target.value)} className="min-w-0 flex-1 border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)]" />
                <label className="shrink-0 px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm font-semibold cursor-pointer">
                  {uploading ? ui.saving : ui.uploadImage}
                  <input type="file" accept="image/*" className="hidden" onChange={e => upload(e.target.files?.[0] ?? null)} />
                </label>
              </div>
            </label>
            <label className="block text-sm font-medium sm:col-span-2">
              {ui.termsEs}
              <textarea value={form.terms_es} onChange={e => set('terms_es', e.target.value)} rows={4} className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)]" />
            </label>
            <label className="block text-sm font-medium sm:col-span-2">
              {ui.termsEn}
              <textarea value={form.terms_en} onChange={e => set('terms_en', e.target.value)} rows={4} className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)]" />
            </label>
            <label className="block text-sm font-medium">
              {ui.organizer}
              <input value={form.organizer_name} onChange={e => set('organizer_name', e.target.value)} className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)]" />
            </label>
            <label className="block text-sm font-medium">
              {ui.organizerContact}
              <input value={form.organizer_contact} onChange={e => set('organizer_contact', e.target.value)} className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)]" />
            </label>
            <label className="block text-sm font-medium sm:col-span-2">
              {ui.permit}
              <input value={form.permit_reference} onChange={e => set('permit_reference', e.target.value)} className="mt-1 w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)]" />
            </label>
            <label className="sm:col-span-2 flex items-start gap-2 text-sm text-[var(--color-muted)]">
              <input className="mt-1" type="checkbox" checked={form.attested} onChange={e => set('attested', e.target.checked)} />
              <span>{ui.attestation} {ui.tosPrefix} <Link href="/terminos" className="underline">{ui.tosLink}</Link>.</span>
            </label>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm font-semibold disabled:opacity-50">
              {saving ? ui.saving : ui.save}
            </button>
          </div>
        </form>

        <section>
          <h2 className="font-semibold mb-3">{ui.campaigns}</h2>
          {campaigns.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)] border border-[var(--color-border)] rounded-xl p-5">{ui.empty}</p>
          ) : (
            <div className="space-y-3">
              {campaigns.map(campaign => {
                const b = broadcast[campaign.id] ?? { es: '', en: '', coupon: '', sending: false }
                return (
                  <article key={campaign.id} className="border border-[var(--color-border)] rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold truncate">{campaign.title_es ?? campaign.title_en ?? campaign.slug}</h3>
                        <p className="text-xs text-[var(--color-muted)] mt-1">
                          {ui.status}: {statusLabel(ui, campaign.status)} · {ui.entries}: {campaign.stats.entries} · {ui.tickets}: {campaign.stats.tickets}
                        </p>
                      </div>
                      <button className="text-sm underline" onClick={() => setForm(formFromCampaign(campaign))}>
                        {ui.edit}
                      </button>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link href={`/g/${campaign.slug}`} target="_blank" className="px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm no-underline">{ui.viewPublic}</Link>
                      <button className="px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm" onClick={() => copyPublic(campaign.slug)}>{ui.copyLink}</button>
                      <a href={`/api/sell/sweepstakes/${campaign.id}/qr`} className="px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm no-underline">{ui.downloadQr}</a>
                      {campaign.status === 'draft' && (
                        <button disabled={!canPublish || publishingId === campaign.id} className="px-3 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm font-semibold disabled:opacity-50" onClick={() => publish(campaign)}>
                          {publishingId === campaign.id ? ui.publishing : ui.publish}
                        </button>
                      )}
                    </div>

                    {campaign.status === 'completed' && (
                      <div className="mt-4 rounded-lg bg-[var(--color-surface-alt)] p-3">
                        <p className="text-sm font-semibold">{ui.winner}</p>
                        <p className="text-sm text-[var(--color-muted)]">{ui.maskedContact}: {campaign.winner_masked_contact ?? '-'}</p>
                        <pre className="mt-2 max-h-32 overflow-auto text-xs whitespace-pre-wrap">{JSON.stringify(campaign.draw_audit ?? {}, null, 2)}</pre>

                        {!campaign.consolation_sent_at && (
                          <div className="mt-3 space-y-2">
                            <textarea placeholder={ui.consolationEs} value={b.es} onChange={e => setBroadcast(prev => ({ ...prev, [campaign.id]: { ...b, es: e.target.value } }))} className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)] text-sm" />
                            <textarea placeholder={ui.consolationEn} value={b.en} onChange={e => setBroadcast(prev => ({ ...prev, [campaign.id]: { ...b, en: e.target.value } }))} className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)] text-sm" />
                            <input placeholder={ui.couponCode} value={b.coupon} onChange={e => setBroadcast(prev => ({ ...prev, [campaign.id]: { ...b, coupon: e.target.value.toUpperCase() } }))} className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-background)] text-sm" />
                            <button disabled={b.sending} onClick={() => sendConsolation(campaign)} className="px-3 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm font-semibold disabled:opacity-50">
                              {ui.sendConsolation}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
