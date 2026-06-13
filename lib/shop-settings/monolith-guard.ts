/**
 * Anti-monolith guard for the shop-settings surface.
 *
 * Sprint 4 of the Shop Settings refactor deleted the 4,076-line `ShopSettings.tsx`
 * monolith, leaving one component per section under `app/shop/manage/settings/`.
 * This guard keeps it that way — the same idea as the raw-color guard
 * (`design-token-audit.ts`) keeping the surface tokenized:
 *
 *   - no settings component may exceed `MAX_SETTINGS_COMPONENT_LINES`, and
 *   - `ShopSettings.tsx` (or any banned filename) may never reappear.
 *
 * Pure + next-free (only `node:fs`/`node:path` for the real-tree scan), so the
 * Playwright `api` runner can exercise it with in-memory fixtures for free.
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export type SettingsFile = {
  filePath: string
  content: string
}

export type MonolithOffense = {
  filePath: string
  /** `oversized` = over the line cap; `banned` = a forbidden filename reappeared. */
  kind: 'oversized' | 'banned'
  detail: string
}

/** The settings surface root, relative to the repo root. */
export const SETTINGS_DIR = 'app/shop/manage/settings'

/**
 * Line cap for any single settings component. The largest extracted section after
 * Sprint 4 is `_sections/Canal.tsx` (~1,063 lines); 1,200 clears it with headroom
 * while still flagging any slide back toward the ~4,000-line monolith.
 */
export const MAX_SETTINGS_COMPONENT_LINES = 1200

/** Filenames that must never come back. Matched by basename. */
export const BANNED_SETTINGS_BASENAMES = new Set(['ShopSettings.tsx'])

const settingsExtensions = new Set(['.ts', '.tsx'])

function countLines(content: string): number {
  if (content === '') return 0
  // Trailing newline shouldn't inflate the count by one phantom line.
  const normalized = content.endsWith('\n') ? content.slice(0, -1) : content
  return normalized.split('\n').length
}

export function findOversizedSettingsFiles(files: SettingsFile[]): MonolithOffense[] {
  const offenders: MonolithOffense[] = []
  for (const file of files) {
    const lines = countLines(file.content)
    if (lines > MAX_SETTINGS_COMPONENT_LINES) {
      offenders.push({
        filePath: file.filePath,
        kind: 'oversized',
        detail: `${lines} lines > ${MAX_SETTINGS_COMPONENT_LINES} cap`,
      })
    }
  }
  return offenders
}

export function findBannedSettingsFiles(files: SettingsFile[]): MonolithOffense[] {
  const offenders: MonolithOffense[] = []
  for (const file of files) {
    if (BANNED_SETTINGS_BASENAMES.has(path.basename(file.filePath))) {
      offenders.push({
        filePath: file.filePath,
        kind: 'banned',
        detail: 'banned settings component reappeared',
      })
    }
  }
  return offenders
}

export function formatMonolithOffense(offense: MonolithOffense): string {
  return `${offense.filePath}: ${offense.detail}`
}

/** Recursively read every `.ts`/`.tsx` file under the settings surface. */
export async function scanSettingsTree(repoRoot: string, dir = SETTINGS_DIR): Promise<SettingsFile[]> {
  const absoluteDir = path.join(repoRoot, dir)
  const entries = await readdir(absoluteDir, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return scanSettingsTree(repoRoot, entryPath)
    if (!settingsExtensions.has(path.extname(entry.name))) return []
    return [{ filePath: entryPath, content: await readFile(path.join(repoRoot, entryPath), 'utf8') }]
  }))
  return nested.flat()
}
