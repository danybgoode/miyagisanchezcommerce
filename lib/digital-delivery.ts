/**
 * lib/digital-delivery.ts
 *
 * PDP redesign (epic 01) — Sprint 4, S4.3 (digital goods).
 *
 * Pure, next-free seam for the digital "entrega al instante" hero. Turns the
 * stored `metadata.digital_file` ({name,size,label}) into a display model (file
 * name · format from the extension · human size) and reinterprets the specs as
 * formato · tamaño — plus licencia / compatibilidad / incluye ONLY when the
 * seller actually stored them (no new capture; honest, never invented). No JSX /
 * no network / no `next/*` → unit-testable in the `api` gate
 * (`e2e/digital-delivery.spec.ts`).
 */

import type { Spec } from './listing-attributes'

export interface DigitalFile {
  name?: string
  size?: number
  label?: string
}

export interface DigitalFileInfo {
  name: string | null
  /** Uppercased file extension, e.g. "PDF", "ZIP". Null when none. */
  format: string | null
  /** Human size, e.g. "820 KB", "3.4 MB". Null when size is absent/invalid. */
  sizeLabel: string | null
}

function formatBytes(size: unknown): string | null {
  const n = typeof size === 'number' ? size : Number(size)
  if (!n || Number.isNaN(n) || n <= 0) return null
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function extFormat(name: string): string | null {
  const m = name.match(/\.([a-z0-9]+)$/i)
  return m ? m[1].toUpperCase() : null
}

export function digitalFileInfo(file: DigitalFile | null | undefined): DigitalFileInfo {
  const name = file?.name?.trim() || null
  return {
    name,
    format: name ? extFormat(name) : null,
    sizeLabel: formatBytes(file?.size),
  }
}

/**
 * The reinterpreted digital specs: formato · tamaño always (when derivable), then
 * licencia / compatibilidad / incluye only if the seller stored them on metadata
 * (`digital_license` / `digital_compatibility` / `digital_includes`). Empty when
 * nothing is known.
 */
export function digitalSpecs(
  file: DigitalFile | null | undefined,
  metadata: Record<string, unknown> | null | undefined,
): Spec[] {
  const info = digitalFileInfo(file)
  const meta = metadata ?? {}
  const specs: Spec[] = []
  if (info.format) specs.push({ label: 'Formato', value: info.format })
  if (info.sizeLabel) specs.push({ label: 'Tamaño', value: info.sizeLabel })
  const optional: Array<[string, string]> = [
    ['Licencia', 'digital_license'],
    ['Compatibilidad', 'digital_compatibility'],
    ['Incluye', 'digital_includes'],
  ]
  for (const [label, key] of optional) {
    const raw = meta[key]
    if (typeof raw === 'string' && raw.trim()) specs.push({ label, value: raw.trim() })
  }
  return specs
}
