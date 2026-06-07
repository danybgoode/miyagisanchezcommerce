import { test, expect } from '@playwright/test'
import {
  genLinkToken,
  isLinkTokenFormat,
  parseStartCommand,
  isTokenExpired,
  LINK_TOKEN_TTL_MS,
} from '../lib/notifications/telegram-link'
import { resolveChatId } from '../lib/telegram'

/**
 * Granular Multi-Channel Notifications · Sprint 2.
 * Pure-logic guards on the Telegram link helpers — no network, no auth.
 * These enforce the live-doc deep-link rules (url-safe payload, <= 64 chars,
 * `/start <payload>` parsing) that the link route + webhook depend on.
 */

test.describe('telegram-link · token format', () => {
  test('genLinkToken is url-safe and <= 64 chars (Telegram start-payload limit)', () => {
    for (let i = 0; i < 50; i++) {
      const t = genLinkToken()
      expect(isLinkTokenFormat(t)).toBe(true)
      expect(t.length).toBeLessThanOrEqual(64)
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  test('genLinkToken is effectively unique', () => {
    const set = new Set(Array.from({ length: 200 }, () => genLinkToken()))
    expect(set.size).toBe(200)
  })

  test('isLinkTokenFormat rejects spaces, empties, and oversized payloads', () => {
    expect(isLinkTokenFormat('abc-DEF_123')).toBe(true)
    expect(isLinkTokenFormat('')).toBe(false)
    expect(isLinkTokenFormat('has space')).toBe(false)
    expect(isLinkTokenFormat('a'.repeat(65))).toBe(false)
    expect(isLinkTokenFormat('illegal!')).toBe(false)
    expect(isLinkTokenFormat(123)).toBe(false)
    expect(isLinkTokenFormat(null)).toBe(false)
  })
})

test.describe('telegram-link · parseStartCommand', () => {
  test('extracts the payload from /start <token>', () => {
    expect(parseStartCommand('/start abc-123')).toBe('abc-123')
    expect(parseStartCommand('  /start abc-123  ')).toBe('abc-123')
  })

  test('handles the group form /start@bot <token>', () => {
    expect(parseStartCommand('/start@MiyagiBot abc_DEF')).toBe('abc_DEF')
  })

  test('returns null for non-linking messages', () => {
    expect(parseStartCommand('/start')).toBeNull()      // bare start, no payload
    expect(parseStartCommand('/help abc')).toBeNull()
    expect(parseStartCommand('hello there')).toBeNull()
    expect(parseStartCommand('/start a b')).toBeNull()  // two tokens
    expect(parseStartCommand('/start ' + 'a'.repeat(65))).toBeNull() // oversized
    expect(parseStartCommand(undefined)).toBeNull()
    expect(parseStartCommand(42)).toBeNull()
  })

  test('round-trips a real minted token', () => {
    const t = genLinkToken()
    expect(parseStartCommand(`/start ${t}`)).toBe(t)
  })
})

test.describe('tgSend · chat targeting (resolveChatId)', () => {
  test('an explicit chat id is used verbatim', () => {
    expect(resolveChatId('555', 'admin')).toBe('555')
  })

  test('a missing/empty chat id falls back to the admin default', () => {
    expect(resolveChatId(undefined, 'admin')).toBe('admin')
    expect(resolveChatId(null, 'admin')).toBe('admin')
    expect(resolveChatId('', 'admin')).toBe('admin')
  })

  test('no target at all → undefined (no send)', () => {
    expect(resolveChatId(undefined, undefined)).toBeUndefined()
    expect(resolveChatId('', '')).toBeUndefined()
  })
})

test.describe('telegram-link · expiry', () => {
  test('a fresh token (now + TTL) is not expired', () => {
    const exp = new Date(Date.now() + LINK_TOKEN_TTL_MS).toISOString()
    expect(isTokenExpired(exp)).toBe(false)
  })

  test('a past expiry is expired', () => {
    const exp = new Date(Date.now() - 1000).toISOString()
    expect(isTokenExpired(exp)).toBe(true)
  })
})
