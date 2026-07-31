import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { FLAG_KEYS } from '../lib/flag-catalog'
import {
  deriveFlagInventory,
  FLAG_INVENTORY_REPORT_PATH,
  renderFlagInventory,
} from '../scripts/derive-flag-inventory'

test('pinned frontend inventory exactly matches typed production callsites', () => {
  const root = process.cwd()
  const report = deriveFlagInventory(root)
  const pinned = fs.readFileSync(path.join(root, FLAG_INVENTORY_REPORT_PATH), 'utf8')

  expect(pinned).toBe(renderFlagInventory(report))
  expect(report.flags).toHaveLength(41)
  expect(new Set(report.flags.map((entry) => entry.key)).size).toBe(FLAG_KEYS.length)
  expect(report.flags.filter((entry) => entry.enforcement === 'both')).toHaveLength(12)
  expect(report.flags.filter((entry) => entry.enforcement === 'backend')).toEqual([
    expect.objectContaining({
      key: 'ml.orders_enabled',
      callsites: [],
    }),
  ])
  expect(
    report.flags
      .filter((entry) => entry.enforcement !== 'backend')
      .every((entry) => entry.callsites.length > 0),
  ).toBe(true)
})
