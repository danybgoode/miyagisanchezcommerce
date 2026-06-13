import { test, expect } from '@playwright/test'
import { digitalFileInfo, digitalSpecs } from '../lib/digital-delivery'

/**
 * PDP redesign (epic 01) — Sprint 4, S4.3 (digital goods).
 *
 * Pure-logic gate for the instant-delivery hero model + reinterpreted specs.
 * No network / no `next/*` — runs in the `api` gate. Optional specs surface ONLY
 * when the seller stored them (never invented).
 */

test.describe('digital-delivery · digitalFileInfo', () => {
  test('derives name, uppercased format, and a human size', () => {
    const info = digitalFileInfo({ name: 'plantilla.pdf', size: 3_500_000 })
    expect(info.name).toBe('plantilla.pdf')
    expect(info.format).toBe('PDF')
    expect(info.sizeLabel).toBe('3.3 MB')
  })

  test('sub-MB sizes render in KB; missing/invalid size → null', () => {
    expect(digitalFileInfo({ name: 'a.zip', size: 820_000 }).sizeLabel).toBe('801 KB')
    expect(digitalFileInfo({ name: 'a.zip' }).sizeLabel).toBeNull()
    expect(digitalFileInfo({ name: 'a.zip', size: 0 }).sizeLabel).toBeNull()
  })

  test('a name without an extension has no format', () => {
    expect(digitalFileInfo({ name: 'README' }).format).toBeNull()
  })

  test('absent file → all null', () => {
    const info = digitalFileInfo(undefined)
    expect(info.name).toBeNull()
    expect(info.format).toBeNull()
    expect(info.sizeLabel).toBeNull()
  })
})

test.describe('digital-delivery · digitalSpecs (reinterpreted)', () => {
  test('formato + tamaño from the file', () => {
    const specs = digitalSpecs({ name: 'curso.zip', size: 12_000_000 }, null)
    expect(specs).toEqual([
      { label: 'Formato', value: 'ZIP' },
      { label: 'Tamaño', value: '11.4 MB' },
    ])
  })

  test('licencia / compatibilidad / incluye appear only when stored', () => {
    const specs = digitalSpecs(
      { name: 'pack.pdf', size: 500_000 },
      { digital_license: 'Uso personal', digital_compatibility: 'iOS · Android', digital_includes: '3 archivos' },
    )
    expect(specs).toContainEqual({ label: 'Licencia', value: 'Uso personal' })
    expect(specs).toContainEqual({ label: 'Compatibilidad', value: 'iOS · Android' })
    expect(specs).toContainEqual({ label: 'Incluye', value: '3 archivos' })
  })

  test('empty / non-string optional metadata is skipped (never invented)', () => {
    const specs = digitalSpecs({ name: 'x.pdf' }, { digital_license: '  ', digital_includes: 42 })
    expect(specs.find(s => s.label === 'Licencia')).toBeUndefined()
    expect(specs.find(s => s.label === 'Incluye')).toBeUndefined()
    // formato still present (from the .pdf extension)
    expect(specs).toContainEqual({ label: 'Formato', value: 'PDF' })
  })

  test('nothing derivable → empty list', () => {
    expect(digitalSpecs(undefined, null)).toEqual([])
  })
})
