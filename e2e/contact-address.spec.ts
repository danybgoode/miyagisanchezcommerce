import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { CONTACT_EMAIL, contactMailto } from '../lib/contact'

const ROOT = path.resolve(import.meta.dirname, '..')
const source = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')

/**
 * The platform had no reachable human address ANYWHERE on the site. The only
 * way to contact anyone was to reply to an email we had already sent — which a
 * visitor with a question has, by definition, never received.
 *
 * This spec pins two things: that the address is stated once and imported
 * everywhere, and that it is actually PRESENT on the surfaces where someone
 * looks for it. A constant nothing renders is not a contact channel.
 */

test.describe('the contact address is single-sourced', () => {
  test('it is defined once and every consumer imports it', () => {
    expect(CONTACT_EMAIL).toBe('hola@miyagisanchez.com')

    // `lib/email.ts` sets this as the Reply-To on all ~63 senders. It used to
    // hold its own copy of the literal; two copies of a support address
    // eventually become two addresses, and the wrong half is a channel nobody
    // reads. It must IMPORT, not restate.
    const email = source('lib/email.ts')
    expect(email).toContain("import { CONTACT_EMAIL }")
    expect(email).toContain('const REPLY_TO = CONTACT_EMAIL')
  })

  test('no file outside lib/contact.ts hardcodes the address in code', () => {
    // Locale JSON is exempt: the /terminos contact clause is editable copy that
    // names the address inside a sentence, which is a different thing from a
    // second definition — and it is reachable in /admin/contenido, so Daniel can
    // change it without a deploy.
    const offenders: string[] = []
    for (const file of [
      'app/components/PlatformShell.tsx',
      'app/not-found.tsx',
      'app/(shell)/acerca/page.tsx',
      'app/(shell)/acerca/_components/AboutSections.tsx',
      'lib/email.ts',
    ]) {
      if (source(file).includes('hola@miyagisanchez.com')) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  test('contactMailto encodes its subject', () => {
    expect(contactMailto()).toBe(`mailto:${CONTACT_EMAIL}`)
    expect(contactMailto('Página no encontrada')).toBe(
      `mailto:${CONTACT_EMAIL}?subject=P%C3%A1gina%20no%20encontrada`,
    )
  })
})

test.describe('the address is actually rendered where people look', () => {
  test('the site footer carries a contact link', () => {
    const shell = source('app/components/PlatformShell.tsx')
    expect(shell).toContain('data-testid="footer-contact"')
    expect(shell).toContain('contactMailto(')
    expect(shell).toContain('copy.footer.contact')
  })

  test('the footer copy key exists in both locales', () => {
    for (const locale of ['es', 'en']) {
      const dict = JSON.parse(source(`locales/${locale}.json`))
      expect(dict.buyerShell.footer.contact, `${locale} footer.contact`).toBeTruthy()
    }
  })

  test('the 404 page offers it — the page a stuck person is most likely on', () => {
    expect(source('app/not-found.tsx')).toContain('CONTACT_EMAIL')
  })

  test('/terminos carries a contact clause, in both locales', () => {
    for (const locale of ['es', 'en']) {
      const dict = JSON.parse(source(`locales/${locale}.json`))
      const sections: { title: string; body: string }[] = dict.terms.sections
      const contact = sections.find((s) => s.body.includes(CONTACT_EMAIL))
      expect(contact, `${locale} terms must name the contact address`).toBeTruthy()
    }
  })

  test('/acerca states it in words AND in the Organization JSON-LD', () => {
    // The machine-readable half matters here specifically: this platform is
    // UCP-native, and an agent asking "how do I reach this marketplace" should
    // not have to scrape a footer to find out.
    expect(source('app/(shell)/acerca/_components/AboutSections.tsx')).toContain('CONTACT_EMAIL')
    expect(source('app/(shell)/acerca/page.tsx')).toContain('email: CONTACT_EMAIL')
  })

  test('the WHITE-LABEL footer deliberately does NOT carry it', () => {
    // A buyer on a merchant's own domain has a question for THAT merchant. The
    // platform's address there would misroute them, and the merchant would
    // never learn a customer had tried. Asserted so the omission reads as a
    // decision rather than as a surface someone forgot.
    expect(source('app/(shell)/s/[slug]/ChannelLayout.tsx')).not.toContain('lib/contact')
  })
})
