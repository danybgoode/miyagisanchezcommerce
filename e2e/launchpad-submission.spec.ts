import { test, expect } from '@playwright/test'
import { sniffManuscript, fileExtension } from '../lib/manuscript-sniff'
import {
  canTransition,
  transitionRequiresNote,
  MANUSCRIPT_FORMATS,
  SUBMISSION_STATUSES,
  type SubmissionStatus,
} from '../lib/launchpad-types'

/**
 * Bookshop launchpad · Sprint 1 — the pure security-critical seams plus the
 * dark-launch HTTP contract.
 *
 * The public submission portal is a HIGH-risk unauthenticated upload surface,
 * so the magic-byte sniff (what makes it safe) is unit-tested exhaustively here
 * — deterministic, no seeded data, no network. The submission state machine is
 * likewise pure. The HTTP arm asserts the fail-safe: while `launchpad.enabled`
 * is OFF (default / seed), every public route rejects with 423 before any shop
 * lookup, validation, or upload — a flag outage can never expose the upload
 * surface. The IP rate-limiter runs one step earlier (matching the sweepstakes
 * routes), so a flooded caller can see 429 first; the assertion accepts either
 * rejection, both of which prove the request never reached real work.
 *
 * Deliberately does NOT assert a successful submit/upload — that needs the flag
 * ON + a real opted-in shop + a live email code, and would write a real object
 * to shared storage on every CI run (same restraint as artwork-upload.spec.ts).
 * That end-to-end path is Daniel's owed money smoke (see sprint-1.md).
 */

// ── Pure: magic-byte sniff (container magic AND extension must agree) ─────────
const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]) // %PDF-1.7
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])            // PK\x03\x04…
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
const JUNK = Buffer.from('this is definitely not a manuscript')

test.describe('launchpad · manuscript sniff (pure)', () => {
  test('a real PDF with a .pdf name → pdf', () => {
    expect(sniffManuscript(new Uint8Array(PDF), 'mi-novela.pdf')).toBe('pdf')
  })

  test('a ZIP container with .epub → epub, with .docx → docx (extension disambiguates)', () => {
    expect(sniffManuscript(new Uint8Array(ZIP), 'libro.epub')).toBe('epub')
    expect(sniffManuscript(new Uint8Array(ZIP), 'libro.docx')).toBe('docx')
  })

  test('magic/extension mismatch is rejected (PDF bytes renamed .docx)', () => {
    expect(sniffManuscript(new Uint8Array(PDF), 'sneaky.docx')).toBeNull()
  })

  test('a ZIP with an off-allowlist extension (.zip) is rejected', () => {
    expect(sniffManuscript(new Uint8Array(ZIP), 'archive.zip')).toBeNull()
  })

  test('a renamed image (JPG bytes as .pdf) is rejected — client MIME/name is never trusted', () => {
    expect(sniffManuscript(new Uint8Array(JPG), 'cover.pdf')).toBeNull()
  })

  test('junk bytes and empty input are rejected', () => {
    expect(sniffManuscript(new Uint8Array(JUNK), 'x.pdf')).toBeNull()
    expect(sniffManuscript(new Uint8Array(), 'x.pdf')).toBeNull()
  })

  test('a correct format but NO extension is rejected (the pairing is strict)', () => {
    expect(sniffManuscript(new Uint8Array(PDF), 'manuscrito')).toBeNull()
  })

  test('fileExtension is case-insensitive and dotfile-safe', () => {
    expect(fileExtension('Novela.PDF')).toBe('pdf')
    expect(fileExtension('.gitignore')).toBe('')
    expect(fileExtension('noext')).toBe('')
  })

  test('every allowed format round-trips through the sniff', () => {
    expect(MANUSCRIPT_FORMATS).toEqual(['pdf', 'epub', 'docx'])
  })
})

// ── Pure: submission state machine ───────────────────────────────────────────
test.describe('launchpad · submission state machine (pure)', () => {
  test('the shop can open, approve, reject, or ask for changes from submitted', () => {
    expect(canTransition('submitted', 'in_review')).toBe(true)
    expect(canTransition('submitted', 'approved')).toBe(true)
    expect(canTransition('submitted', 'rejected')).toBe(true)
    expect(canTransition('submitted', 'changes_requested')).toBe(true)
  })

  test('changes_requested returns to submitted on re-submit; rejected is terminal', () => {
    expect(canTransition('changes_requested', 'submitted')).toBe(true)
    expect(canTransition('rejected', 'submitted')).toBe(false)
    expect(canTransition('rejected', 'approved')).toBe(false)
  })

  test('a no-op self-transition is never allowed', () => {
    for (const s of SUBMISSION_STATUSES) {
      expect(canTransition(s as SubmissionStatus, s as SubmissionStatus)).toBe(false)
    }
  })

  test('reject / changes_requested must carry a note; approve / in_review need none', () => {
    expect(transitionRequiresNote('rejected')).toBe(true)
    expect(transitionRequiresNote('changes_requested')).toBe(true)
    expect(transitionRequiresNote('approved')).toBe(false)
    expect(transitionRequiresNote('in_review')).toBe(false)
  })
})

// ── HTTP: dark-launch fail-safe (flag OFF by default) ────────────────────────
const SLUG = 'launchpad-e2e-nonexistent-shop'

test.describe('launchpad · public routes are dark while the flag is OFF', () => {
  test('verification → 423 (not 500), never sends a code', async ({ request }) => {
    const res = await request.post(`/api/launchpad/${SLUG}/verification`, {
      data: { email: 'writer@example.com' },
    })
    expect([423, 429]).toContain(res.status())
  })

  test('submit → 423 (not 500) with the feature dark', async ({ request }) => {
    const res = await request.post(`/api/launchpad/${SLUG}/submit`, {
      data: { title: 'x', authorName: 'y', email: 'w@example.com', code: 'ABC123', manuscript: { key: 'k', format: 'pdf' } },
    })
    expect([423, 429]).toContain(res.status())
  })

  test('upload → 423 (not 500) with the feature dark', async ({ request }) => {
    const res = await request.post(`/api/launchpad/${SLUG}/upload`, {
      multipart: { file: { name: 'x.pdf', mimeType: 'application/pdf', buffer: PDF } },
    })
    expect([423, 429]).toContain(res.status())
  })
})
