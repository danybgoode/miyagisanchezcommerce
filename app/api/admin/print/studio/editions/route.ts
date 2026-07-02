/**
 * GET /api/admin/print/studio/editions  (`withPrintStudio` — Clerk admin OR
 * PRINT_STUDIO_TOKEN Bearer)
 * Open editions only, for the zine studio's "Anuncios pagados" drawer (epic
 * zine-editing-central, Story 1.2). Same `print_editions` table the Clerk-only
 * `/api/admin/print/editions` route reads — this is a narrower, machine-authed
 * read of it, not a separate data source.
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { withPrintStudio } from '@/lib/admin/guard'
import type { PrintEdition } from '@/lib/print'

export const dynamic = 'force-dynamic'

export const GET = withPrintStudio(async () => {
  const { data, error } = await db
    .from('print_editions')
    .select('id, title, status, submission_deadline, distribution_date, coverage_zones, tiers, print_providers(name, slug)')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ editions: (data ?? []) as unknown as PrintEdition[] })
})
