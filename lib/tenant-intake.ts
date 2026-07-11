import { db } from '@/lib/supabase'
import { SELLS_OPTIONS, SELLS_WHERE_OPTIONS, type SellsOption, type SellsWhereOption, type DoorKey } from '@/lib/onboarding-personalization'

/**
 * lib/tenant-intake.ts
 *
 * Read/write for the `tenant_intake` Supabase table (onboarding three-doors
 * epic, Sprint 1 · Story 1.1) — non-commerce, additive (AGENTS Rule 2): what
 * a fresh merchant sells and where they sell today, plus which door they
 * picked. One row per Clerk user, upserted. Same `db.from(...)` + typed-
 * interface + degrade-safe pattern as `lib/home-favorites.ts` — every read
 * fails to `null`/safe defaults rather than throwing, so a Supabase hiccup
 * never blocks the onboarding flow (it just falls back to the unpersonalized
 * default, same as `lib/onboarding-personalization.ts`'s `null` branch).
 */

const TABLE = 'tenant_intake'

interface TenantIntakeRow {
  sells: unknown
  sells_where: unknown
  chosen_door: string | null
}

export interface StoredTenantIntake {
  sells: SellsOption[]
  sellsWhere: SellsWhereOption[]
  chosenDoor: DoorKey | null
}

function sanitizeSells(raw: unknown): SellsOption[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is SellsOption => SELLS_OPTIONS.includes(v as SellsOption))
}

function sanitizeSellsWhere(raw: unknown): SellsWhereOption[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is SellsWhereOption => SELLS_WHERE_OPTIONS.includes(v as SellsWhereOption))
}

/** The signed-in user's intake row, or `null` on no row / no user / a read error. */
export async function getTenantIntake(clerkUserId: string | null | undefined): Promise<StoredTenantIntake | null> {
  if (!clerkUserId) return null

  const { data, error } = await db
    .from(TABLE)
    .select('sells, sells_where, chosen_door')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle()

  if (error) {
    console.error('[tenant-intake] read failed:', error)
    return null
  }
  if (!data) return null

  const row = data as unknown as TenantIntakeRow
  return {
    sells: sanitizeSells(row.sells),
    sellsWhere: sanitizeSellsWhere(row.sells_where),
    chosenDoor: (row.chosen_door as DoorKey | null) ?? null,
  }
}

/** Upsert Q1/Q2 chip answers. Leaves `chosen_door` untouched (partial-column upsert). */
export async function saveTenantIntake(
  clerkUserId: string,
  intake: { sells: SellsOption[]; sellsWhere: SellsWhereOption[] },
): Promise<boolean> {
  const { error } = await db
    .from(TABLE)
    .upsert(
      {
        clerk_user_id: clerkUserId,
        sells: intake.sells,
        sells_where: intake.sellsWhere,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'clerk_user_id' },
    )

  if (error) {
    console.error('[tenant-intake] save failed:', error)
    return false
  }
  return true
}

/** Record which door the merchant picked. Leaves Q1/Q2 answers untouched. */
export async function setChosenDoor(clerkUserId: string, door: DoorKey): Promise<boolean> {
  const { error } = await db
    .from(TABLE)
    .upsert(
      { clerk_user_id: clerkUserId, chosen_door: door, updated_at: new Date().toISOString() },
      { onConflict: 'clerk_user_id' },
    )

  if (error) {
    console.error('[tenant-intake] chosen-door save failed:', error)
    return false
  }
  return true
}
