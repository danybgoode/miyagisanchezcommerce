import { expect, test } from '@playwright/test'
import {
  embedPublicReadCandidate,
  marketplacePublicReadCandidate,
  subdomainPublicReadCandidate,
} from '../lib/public-read-routing'

test.describe('public read routing · D9/D10/D19', () => {
  test('marketplace admits only the locked public shop/PDP shapes', () => {
    expect(marketplacePublicReadCandidate('/mx/s/panfleto', '')).toEqual({ kind: 'shop', shopSlug: 'panfleto' })
    expect(marketplacePublicReadCandidate('/mx/s/panfleto/faq', '')).toEqual({ kind: 'shop', shopSlug: 'panfleto', tail: 'faq' })
    expect(marketplacePublicReadCandidate('/mx/l/prod_123', '')).toEqual({ kind: 'listing', listingId: 'prod_123' })
    expect(marketplacePublicReadCandidate('/mx/s/panfleto/claim', '')).toBeNull()
    expect(marketplacePublicReadCandidate('/mx/s/panfleto/convocatoria', '')).toBeNull()
    expect(marketplacePublicReadCandidate('/us/s/panfleto', '')).toBeNull()
  })

  test('preview is exact and every other query stays dynamic', () => {
    expect(marketplacePublicReadCandidate('/mx/s/panfleto', '?preview=1')).toEqual({ kind: 'preview', shopSlug: 'panfleto' })
    expect(marketplacePublicReadCandidate('/mx/s/panfleto', '?preview=1&theme=retro')).toBeNull()
    expect(marketplacePublicReadCandidate('/mx/s/panfleto', '?ref=abc')).toBeNull()
    expect(marketplacePublicReadCandidate('/mx/l/prod_123', '?q=1')).toBeNull()
  })

  test('subdomain and embed admit only their locked empty-query surfaces', () => {
    expect(subdomainPublicReadCandidate('/', '')).toEqual({ kind: 'shop' })
    expect(subdomainPublicReadCandidate('/l/prod_123', '')).toEqual({ kind: 'listing', listingId: 'prod_123' })
    expect(subdomainPublicReadCandidate('/convocatoria', '')).toBeNull()
    expect(subdomainPublicReadCandidate('/', '?x=1')).toBeNull()
    expect(embedPublicReadCandidate('/embed/s/panfleto', '')).toEqual({ kind: 'shop', shopSlug: 'panfleto' })
    expect(embedPublicReadCandidate('/embed/s/panfleto', '?key=secret')).toBeNull()
  })
})
