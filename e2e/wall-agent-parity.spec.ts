import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { MCP_SELLER_TOOLS, MCP_TOOL_NAMES } from '../lib/ucp/capabilities'
import { CONFIG_BLOCKS, validateConfig } from '../lib/settings-import'
import { DEFAULT_RECIPE } from '../lib/shop-presentation/theme'
import { ALL_SECTIONS } from '../lib/shop-presentation/types'

const ROOT = path.resolve(import.meta.dirname, '..')

/**
 * Living Shop · Sprint 6 — agent and configuration parity (Stories 6.1–6.4).
 *
 * The property this sprint rests on (epic D12): an agent cannot reach a laxer
 * rule than a person. That is asserted two ways — the MCP Wall handlers import
 * the SAME validator module the HTTP route does (a source-level check, because
 * the alternative is a live agent token this suite does not have), and the
 * Storefront-as-Code path runs the SAME validators as the seller UI.
 *
 * Observed red by pointing `lib/wall/agent.ts` at a local copy of the validator
 * (the shared-module test failed) and by accepting an unknown recipe field in
 * the presentation block (the round-trip refusal failed).
 */

test.describe('agent parity · the Wall tools exist and are seller-scoped', () => {
  test('all four Wall tools are registered as SELLER tools, never buyer tools', () => {
    for (const tool of ['list_wall_entries', 'create_wall_entry', 'update_wall_entry', 'delete_wall_entry']) {
      expect(MCP_SELLER_TOOLS, tool).toContain(tool)
      expect(MCP_TOOL_NAMES, tool).toContain(tool)
    }
  })

  test('every registered Wall tool has a definition AND a dispatch case', () => {
    // A tool advertised in the manifest with no dispatch case is a capability
    // claim the server cannot honour — the manifest must stay accurate (rule 3).
    const route = readFileSync(path.join(ROOT, 'app/api/ucp/mcp/route.ts'), 'utf8')
    for (const tool of ['list_wall_entries', 'create_wall_entry', 'update_wall_entry', 'delete_wall_entry']) {
      expect(route, `${tool} definition`).toContain(`name: '${tool}'`)
      expect(route, `${tool} dispatch`).toContain(`case '${tool}':`)
    }
  })

  test('the Wall handlers share the human API validator — no second copy', () => {
    const agent = readFileSync(path.join(ROOT, 'lib/wall/agent.ts'), 'utf8')
    expect(agent).toContain("from './validate'")
    expect(agent).toContain("from './resolve'")
    // And no locally-defined validation that could drift from it.
    expect(agent).not.toMatch(/function\s+validate\w*\(/)
  })

  test('every Wall write is audited', () => {
    const route = readFileSync(path.join(ROOT, 'app/api/ucp/mcp/route.ts'), 'utf8')
    for (const tool of ['create_wall_entry', 'update_wall_entry', 'delete_wall_entry']) {
      const handler = route.slice(route.indexOf(`async function handle${toPascal(tool)}`))
      expect(handler.slice(0, 900), tool).toContain('recordAgentWallChange')
    }
  })

  test('the read-only tool does not write an audit entry', () => {
    // The negation: if this ALSO logged, the audit assertion above would pass for
    // a reason that has nothing to do with writes.
    const route = readFileSync(path.join(ROOT, 'app/api/ucp/mcp/route.ts'), 'utf8')
    const handler = route.slice(route.indexOf('async function handleListWallEntries'))
    expect(handler.slice(0, 400)).not.toContain('recordAgentWallChange')
  })
})

function toPascal(snake: string): string {
  return snake.split('_').map((p) => p[0].toUpperCase() + p.slice(1)).join('')
}

test.describe('agent parity · Storefront-as-Code round-trips presentation', () => {
  test('the presentation block is a real config block with a label', () => {
    const block = CONFIG_BLOCKS.find((b) => b.key === 'presentation')
    expect(block).toBeTruthy()
    expect(block!.desc.length).toBeGreaterThan(20)
  })

  test('a valid presentation manifest is accepted and NORMALIZED', () => {
    const result = validateConfig({
      presentation: {
        theme_mode: 'custom',
        theme_recipe: { ...DEFAULT_RECIPE, corners: 'square', accent: '#123456' },
        sections: { order: ['events', 'about'], hidden: ['faq'] },
      },
    })
    expect(result.blocks.find((b) => b.key === 'presentation')?.issues ?? []).toEqual([])
    const settings = (result.patch.settings ?? {}) as Record<string, unknown>
    expect(settings.theme_mode).toBe('custom')
    expect((settings.theme_recipe as Record<string, unknown>).corners).toBe('square')
    // Normalized: the anchors lead whatever the file asked for.
    expect((settings.sections as { order: string[] }).order.slice(0, 2)).toEqual(['wall', 'shop'])
    expect((settings.sections as { order: string[] }).order).toHaveLength(ALL_SECTIONS.length)
  })

  test('a config file cannot express what the editor would refuse', () => {
    // The whole point of epic D12: same validators, both paths.
    for (const bad of [
      { presentation: { theme_mode: 'neon' } },
      { presentation: { theme_recipe: { custom_css: 'body{}' } } },
      { presentation: { theme_recipe: { accent: 'red' } } },
      { presentation: { sections: { order: ['blog'] } } },
      { presentation: { sections: { hidden: ['wall'] } } },
    ]) {
      const result = validateConfig(bad)
      const presentationBlock = result.blocks.find((b) => b.key === 'presentation')
      expect(presentationBlock?.issues.length, JSON.stringify(bad)).toBeGreaterThan(0)
    }
  })

  test('the negation: a fully valid recipe raises no issues', () => {
    const result = validateConfig({ presentation: { theme_recipe: DEFAULT_RECIPE } })
    expect(result.blocks.find((b) => b.key === 'presentation')?.issues).toEqual([])
  })
})

test.describe('agent parity · the public representation exposes the Wall without leaking drafts', () => {
  test('get_shop reads through the SAME function the public page renders', () => {
    // Not a stylistic preference: a second read path is how a draft eventually
    // reaches an agent. The shared function is the guarantee.
    const route = readFileSync(path.join(ROOT, 'app/api/ucp/mcp/route.ts'), 'utf8')
    expect(route).toContain("import { readPublicWall } from '@/lib/wall/public'")
    const handler = route.slice(route.indexOf('async function handleGetShop'))
    expect(handler.slice(0, 4000)).toContain('readPublicWall')
  })

  test('the agent Wall view is bounded', () => {
    const route = readFileSync(path.join(ROOT, 'app/api/ucp/mcp/route.ts'), 'utf8')
    expect(route).toMatch(/const AGENT_WALL_LIMIT = \d+/)
    const limit = Number(route.match(/const AGENT_WALL_LIMIT = (\d+)/)?.[1])
    expect(limit).toBeGreaterThan(0)
    expect(limit).toBeLessThanOrEqual(20)
  })

  test('the manifest describes the Wall tools and the no-escape-hatch guarantee', () => {
    const manifest = readFileSync(path.join(ROOT, 'app/api/ucp/manifest/route.ts'), 'utf8')
    expect(manifest).toContain('wall_entry')
    expect(manifest).toMatch(/no field that can carry CSS/i)
  })
})
