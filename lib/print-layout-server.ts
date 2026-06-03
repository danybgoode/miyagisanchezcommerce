/**
 * Printed-Edition Builder — server-side layout persistence (Phase 4).
 * Thin helpers over the print_layouts table. Editorial data only (AGENTS rule #2).
 */

import { db } from '@/lib/supabase'
import { emptyDocument, type PrintLayout, type PrintLayoutDocument, type PrintPageSize } from '@/lib/print-layout'

/** Load an edition's saved layout, or null if none has been created yet. */
export async function loadLayout(editionId: string): Promise<PrintLayout | null> {
  const { data, error } = await db
    .from('print_layouts')
    .select('edition_id, page_size, document, locked_at, updated_at')
    .eq('edition_id', editionId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return data as PrintLayout
}

/** Load the layout, lazily returning an empty (unsaved) document if none exists. */
export async function loadLayoutOrEmpty(editionId: string): Promise<PrintLayout> {
  const existing = await loadLayout(editionId)
  if (existing) return existing
  return {
    edition_id: editionId,
    page_size: 'carta',
    document: emptyDocument(4),
    locked_at: null,
    updated_at: null,
  }
}

/** Create or replace an edition's layout document. Refuses to write a locked layout. */
export async function upsertLayout(
  editionId: string,
  input: { page_size: PrintPageSize; document: PrintLayoutDocument },
): Promise<PrintLayout> {
  const existing = await loadLayout(editionId)
  if (existing?.locked_at) throw new Error('La maqueta está bloqueada (enviada a imprenta).')

  const { data, error } = await db
    .from('print_layouts')
    .upsert(
      { edition_id: editionId, page_size: input.page_size, document: input.document },
      { onConflict: 'edition_id' },
    )
    .select('edition_id, page_size, document, locked_at, updated_at')
    .single()
  if (error) throw new Error(error.message)
  return data as PrintLayout
}
