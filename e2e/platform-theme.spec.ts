import { expect, test } from '@playwright/test'
import { createContext, Script } from 'node:vm'
import {
  ACTIVE_PLATFORM_THEME_MANIFEST,
  buildPlatformThemeBootScript,
  isSeasonalThemeActive,
  PLATFORM_THEME_STORAGE_KEY,
  resolvePlatformTheme,
} from '../lib/platform-theme'

test.describe('platform seasonal theme engine', () => {
  const bootScriptPattern = /self\.__next_s[\s\S]*platform-theme-bootstrap/

  test('exposes a sanitized active manifest with safe CSS vars', async ({ request }) => {
    const res = await request.get('/api/platform-theme')
    expect(res.ok()).toBeTruthy()

    const body = await res.json() as {
      storageKey: string
      coreId: string
      activeTheme: {
        id: string
        active: boolean
        cssVars: Record<string, string>
        bgPattern: string
      }
      samples: Record<string, boolean>
    }

    expect(body.storageKey).toBe('miyagi:platform-theme')
    expect(body.coreId).toBe('core')
    expect(body.activeTheme.id).toBe('designer-n')
    expect(body.activeTheme.active).toBe(true)
    expect(body.activeTheme.cssVars['--accent']).toMatch(/^#[0-9a-f]{6}$/)
    expect(body.activeTheme.cssVars['--fg-inverse']).toBe('#ffffff')
    expect(body.activeTheme.bgPattern).not.toContain('url(')
  })

  test('keeps the seasonal scope on public platform browsing surfaces only', async ({ request }) => {
    const res = await request.get('/api/platform-theme?path=/checkout')
    expect(res.ok()).toBeTruthy()
    const body = await res.json() as { eligible: boolean; samples: Record<string, boolean> }

    expect(body.eligible).toBe(false)
    expect(body.samples.home).toBe(true)
    expect(body.samples.listings).toBe(true)
    expect(body.samples.listingDetail).toBe(true)
    expect(body.samples.agent).toBe(true)
    expect(body.samples.sellerStorefront).toBe(false)
    expect(body.samples.embed).toBe(false)
    expect(body.samples.checkout).toBe(false)
    expect(body.samples.dashboard).toBe(false)
    expect(body.samples.admin).toBe(false)
    expect(body.samples.account).toBe(false)
  })

  test('falls back safely for invalid fields and sunset campaigns', () => {
    const theme = resolvePlatformTheme({
      ...ACTIVE_PLATFORM_THEME_MANIFEST,
      status: 'sunset',
      accent: '#ffffff',
      logo: { desktop: '', compact: '' },
      tagline: { es: '', en: '' },
      bg_pattern: { css: 'radial-gradient(circle, red, transparent); color: red' },
    })

    expect(theme.active).toBe(false)
    expect(theme.cssVars['--accent']).toBe('#1d6f42')
    expect(theme.logo.desktop).toBe('Miyagi Sanchez')
    expect(theme.logo.compact).toBe('MS')
    expect(theme.tagline.es).toBe('Abre tu tienda, compra y vende')
    expect(theme.bgPattern).toBe('none')

    expect(isSeasonalThemeActive({
      ...ACTIVE_PLATFORM_THEME_MANIFEST,
      endsAt: '2026-01-01T00:00:00.000Z',
    }, Date.parse('2026-06-05T00:00:00.000Z'))).toBe(false)
  })

  test('bootstrap applies saved seasonal preference only on eligible routes', () => {
    function runBootstrap(pathname: string, saved: string | null) {
      const style = new Map<string, string>()
      const attributes = new Map<string, string>()
      const storage = new Map<string, string>()
      if (saved) storage.set(PLATFORM_THEME_STORAGE_KEY, saved)

      const context = createContext({
        document: {
          documentElement: {
            setAttribute: (name: string, value: string) => attributes.set(name, value),
            removeAttribute: (name: string) => attributes.delete(name),
            style: {
              setProperty: (name: string, value: string) => style.set(name, value),
              removeProperty: (name: string) => style.delete(name),
            },
          },
        },
        localStorage: {
          getItem: (name: string) => storage.get(name) ?? null,
          setItem: (name: string, value: string) => storage.set(name, value),
        },
        location: { pathname },
      })

      new Script(buildPlatformThemeBootScript()).runInContext(context)

      return {
        theme: attributes.get('data-platform-theme') ?? null,
        accent: style.get('--accent') ?? null,
        saved: storage.get(PLATFORM_THEME_STORAGE_KEY) ?? null,
      }
    }

    expect(runBootstrap('/agent', 'designer-n')).toMatchObject({
      theme: 'designer-n',
      accent: '#9f4f3f',
      saved: 'designer-n',
    })
    expect(runBootstrap('/terminos', 'designer-n')).toMatchObject({
      theme: null,
      accent: null,
      saved: 'designer-n',
    })
    expect(runBootstrap('/agent', 'unknown-theme')).toMatchObject({
      theme: null,
      accent: null,
      saved: 'core',
    })
  })

  test('queues the boot script before paint on eligible platform pages only', async ({ request }) => {
    const platform = await request.get('/agent', { headers: { Accept: 'text/html' } })
    const platformHtml = await platform.text()
    expect(platformHtml).toMatch(bootScriptPattern)
    expect(platformHtml).toContain('data-platform-theme-toggle')

    const terms = await request.get('/terminos', { headers: { Accept: 'text/html' } })
    const termsHtml = await terms.text()
    expect(termsHtml).not.toMatch(bootScriptPattern)
  })
})
