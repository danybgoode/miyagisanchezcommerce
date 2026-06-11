import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const TITLE = 'Miyagi Sánchez — Abre tu tienda, compra y vende'
const DESCRIPTION =
  'El nuevo punto de encuentro para comprar y vender de todo en México. Encuentra cosas de segunda mano, eventos, productos o servicios, abre tu propia tienda y vende sin comisiones.'
const OLD_POSITIONING = 'Infraestructura de comercio'
const OG_TAGLINE = 'Compra y vende de todo en México · Sin comisiones'
const OG_PILLS = ['Marketplace', 'Segundamano', 'Tu propia tienda', '0% comisión'] as const

test.describe('marketplace positioning metadata', () => {
  test('homepage head uses marketplace positioning copy', async ({ request }) => {
    const res = await request.get('/', { headers: { Accept: 'text/html' } })
    expect(res.ok()).toBeTruthy()

    const html = await res.text()

    expect(html).toContain(TITLE)
    expect(getMetaContents(html, 'name', 'description')).toContain(DESCRIPTION)
    expect(getMetaContents(html, 'property', 'og:title')).toContain(TITLE)
    expect(getMetaContents(html, 'property', 'og:description')).toContain(DESCRIPTION)
    expect(getMetaContents(html, 'name', 'twitter:title')).toContain(TITLE)
    expect(getMetaContents(html, 'name', 'twitter:description')).toContain(DESCRIPTION)
    expect(getMetaContents(html, 'name', 'keywords').join(',')).toContain('marketplace México')
    expect(html).not.toContain(OLD_POSITIONING)
  })

  test('opengraph image route and source stay on marketplace positioning copy', async ({ request }) => {
    const res = await request.get('/opengraph-image')
    expect(res.ok()).toBeTruthy()
    expect(res.headers()['content-type']).toContain('image/png')
    expect((await res.body()).byteLength).toBeGreaterThan(1000)

    const source = readFileSync(new URL('../app/opengraph-image.tsx', import.meta.url), 'utf8')
    expect(source).toContain(`export const alt = '${TITLE}'`)
    expect(source).toContain(OG_TAGLINE)
    for (const pill of OG_PILLS) {
      expect(source).toContain(`'${pill}'`)
    }
    expect(source).not.toContain(OLD_POSITIONING)
    expect(source).not.toContain('Dominio propio')
    expect(source).not.toContain('API agentic')
  })
})

function getMetaContents(html: string, attrName: 'name' | 'property', attrValue: string): string[] {
  return getTags(html, 'meta')
    .filter((tag) => getAttribute(tag, attrName) === attrValue)
    .map((tag) => getAttribute(tag, 'content'))
    .filter((value): value is string => Boolean(value))
}

function getTags(html: string, tagName: 'meta'): string[] {
  return html.match(new RegExp(`<${tagName}\\b[^>]*>`, 'g')) ?? []
}

function getAttribute(tag: string, attrName: string): string | undefined {
  const match = tag.match(new RegExp(`${attrName}=["']([^"']+)["']`, 'i'))
  return match?.[1]
}
