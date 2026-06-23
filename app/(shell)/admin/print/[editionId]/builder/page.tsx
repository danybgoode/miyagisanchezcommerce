import { redirect } from 'next/navigation'
import { db } from '@/lib/supabase'
import { requireAdmin } from '@/lib/admin/guard'
import type { PrintTier } from '@/lib/print'
import BuilderClient from './BuilderClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Maqueta — Edición impresa' }

/**
 * Printed-edition builder (Phase 4) — full-width layout workspace for one edition.
 * **Clerk-gated.** The edition (title + tiers) is loaded server-side; the client
 * owns the layout document + autosave.
 */
export default async function BuilderPage({
  params,
}: {
  params: Promise<{ editionId: string }>
}) {
  await requireAdmin()

  const { editionId } = await params
  const { data: edition } = (await db
    .from('print_editions')
    .select('id, title, tiers, status')
    .eq('id', editionId)
    .maybeSingle()) as { data: { id: string; title: string; tiers: PrintTier[]; status: string } | null }

  if (!edition) redirect('/admin/print')

  return (
    <BuilderClient
      editionId={edition.id}
      editionTitle={edition.title}
      tiers={edition.tiers ?? []}
    />
  )
}
