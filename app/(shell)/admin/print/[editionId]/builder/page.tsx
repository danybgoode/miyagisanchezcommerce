import { redirect } from 'next/navigation'
import { db } from '@/lib/supabase'
import type { PrintTier } from '@/lib/print'
import BuilderClient from './BuilderClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Maqueta — Edición impresa' }

/**
 * Printed-edition builder (Phase 4) — full-width layout workspace for one edition.
 * Secret-gated like the rest of the print admin (?secret=<ADMIN_SECRET>). The edition
 * (title + tiers) is loaded server-side; the client owns the layout document + autosave.
 */
export default async function BuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ editionId: string }>
  searchParams: Promise<{ secret?: string }>
}) {
  const { secret } = await searchParams
  if (!secret || secret !== process.env.ADMIN_SECRET) redirect('/')

  const { editionId } = await params
  const { data: edition } = (await db
    .from('print_editions')
    .select('id, title, tiers, status')
    .eq('id', editionId)
    .maybeSingle()) as { data: { id: string; title: string; tiers: PrintTier[]; status: string } | null }

  if (!edition) redirect(`/admin/print?secret=${encodeURIComponent(secret)}`)

  return (
    <BuilderClient
      secret={secret}
      editionId={edition.id}
      editionTitle={edition.title}
      tiers={edition.tiers ?? []}
    />
  )
}
