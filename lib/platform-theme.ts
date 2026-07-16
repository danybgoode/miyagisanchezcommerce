export type PlatformThemeChoice = 'core' | 'designer-n'
export type PlatformThemeStatus = 'active' | 'sunset'

export type PlatformThemeLogo = {
  desktop: string
  compact: string
}

export type PlatformThemeSpotIllustration = {
  slot: 'home-corner' | 'listing-rail'
  className: string
  label: string
}

export type PlatformThemeManifest = {
  id: Exclude<PlatformThemeChoice, 'core'>
  revision: string
  status: PlatformThemeStatus
  startsAt?: string
  endsAt?: string
  label: {
    es: string
    en: string
  }
  accent?: string
  logo?: Partial<PlatformThemeLogo>
  tagline?: {
    es?: string
    en?: string
  }
  bg_pattern?: {
    css?: string
  }
  spot_illustrations?: PlatformThemeSpotIllustration[]
}

export type ResolvedPlatformTheme = {
  id: Exclude<PlatformThemeChoice, 'core'>
  revision: string
  active: boolean
  label: {
    es: string
    en: string
  }
  logo: PlatformThemeLogo
  tagline: {
    es: string
    en: string
  }
  bgPattern: string
  spotIllustrations: PlatformThemeSpotIllustration[]
  cssVars: Record<string, string>
}

const CORE_ACCENT = '#1d6f42'
const CORE_ACCENT_HOVER = '#185a36'
const CORE_ACCENT_SOFT = '#eef4f0'
const CORE_ACCENT_INK = '#114128'
const CORE_ACCENT_FOREGROUND = '#ffffff'
const PAPER = '#f9f9f7'
const INK = '#1a1a18'

export const PLATFORM_OG_COLORS = {
  accent: CORE_ACCENT,
  accentHover: CORE_ACCENT_HOVER,
  accentInk: CORE_ACCENT_INK,
  accentForeground: CORE_ACCENT_FOREGROUND,
  paper: PAPER,
  ink: INK,
  muted: '#6b6b67',
  border: '#dedbd4',
  sunk: '#eeece8',
}

export const PLATFORM_THEME_STORAGE_KEY = 'miyagi:platform-theme'
export const PLATFORM_THEME_CORE_ID: PlatformThemeChoice = 'core'
export const PLATFORM_THEME_ALLOWED_PREFIXES = ['/l', '/agent'] as const

const DEFAULT_LOGO: PlatformThemeLogo = {
  desktop: 'Miyagi Sánchez',
  compact: 'MS',
}

const DEFAULT_TAGLINE = {
  es: 'Abre tu tienda, compra y vende',
  en: 'Open your shop, buy, and sell',
}

export const ACTIVE_PLATFORM_THEME_MANIFEST: PlatformThemeManifest = {
  id: 'designer-n',
  revision: '2026-06-designer-n',
  status: 'active',
  label: {
    es: 'DesignerN',
    en: 'DesignerN',
  },
  accent: '#9f4f3f',
  logo: {
    desktop: 'Miyagi x DesignerN',
    compact: 'DN',
  },
  tagline: {
    es: 'Coleccion de temporada',
    en: 'Seasonal collection',
  },
  bg_pattern: {
    css:
      'radial-gradient(circle at 12% 18%, rgba(159,79,63,0.10) 0 2px, transparent 2.5px), linear-gradient(135deg, rgba(159,79,63,0.08) 0 1px, transparent 1px)',
  },
  spot_illustrations: [
    { slot: 'home-corner', className: 'platform-theme-spot-a', label: 'DesignerN corner mark' },
    { slot: 'listing-rail', className: 'platform-theme-spot-b', label: 'DesignerN rail mark' },
  ],
}

function normalizePath(pathname?: string | null): string {
  if (!pathname) return '/'
  const path = pathname.split('?')[0] || '/'
  return path.startsWith('/') ? path : `/${path}`
}

export function isPlatformThemeEligiblePath(pathname?: string | null): boolean {
  const path = normalizePath(pathname)
  if (path === '/') return true
  return PLATFORM_THEME_ALLOWED_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`))
}

function parseDate(input?: string): number | null {
  if (!input) return null
  const time = Date.parse(input)
  return Number.isFinite(time) ? time : null
}

export function isSeasonalThemeActive(manifest = ACTIVE_PLATFORM_THEME_MANIFEST, now = Date.now()): boolean {
  if (manifest.status !== 'active') return false
  const startsAt = parseDate(manifest.startsAt)
  const endsAt = parseDate(manifest.endsAt)
  if (startsAt !== null && now < startsAt) return false
  if (endsAt !== null && now > endsAt) return false
  return true
}

function parseHexColor(input?: string): { hex: string; r: number; g: number; b: number } | null {
  const match = input?.trim().match(/^#([0-9a-fA-F]{6})$/)
  if (!match) return null
  const hex = `#${match[1].toLowerCase()}`
  return {
    hex,
    r: parseInt(match[1].slice(0, 2), 16),
    g: parseInt(match[1].slice(2, 4), 16),
    b: parseInt(match[1].slice(4, 6), 16),
  }
}

function luminance(hex: string): number {
  const parsed = parseHexColor(hex)
  if (!parsed) return 0
  const channel = [parsed.r, parsed.g, parsed.b].map(value => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4)
  })
  return (0.2126 * channel[0]) + (0.7152 * channel[1]) + (0.0722 * channel[2])
}

export function contrastRatio(a: string, b: string): number {
  const l1 = luminance(a)
  const l2 = luminance(b)
  const high = Math.max(l1, l2)
  const low = Math.min(l1, l2)
  return (high + 0.05) / (low + 0.05)
}

/**
 * Readable text color for an arbitrary accent hex used as a background — white
 * when it clears AA contrast, else the platform ink. Reused by any surface
 * that paints a seller-chosen accent as a background (e.g. the own-shop
 * announcement bar, `AnnouncementBar.tsx`) instead of hardcoding white, which
 * goes illegible on a light/pastel seller accent. Falls back to white for an
 * unparseable/absent hex — matches today's behavior for the platform default
 * accent (a dark green, always AA-safe with white).
 */
export function readableTextOn(hex: string | undefined): string {
  const parsed = parseHexColor(hex)
  if (!parsed) return CORE_ACCENT_FOREGROUND
  return contrastRatio(parsed.hex, '#ffffff') >= 4.5 ? CORE_ACCENT_FOREGROUND : INK
}

function channelToHex(value: number): string {
  return Math.min(255, Math.max(0, value)).toString(16).padStart(2, '0')
}

function shiftColor(hex: string, amount: number): string {
  const parsed = parseHexColor(hex)
  if (!parsed) return CORE_ACCENT_HOVER
  return `#${channelToHex(parsed.r + amount)}${channelToHex(parsed.g + amount)}${channelToHex(parsed.b + amount)}`
}

function accentTokens(input?: string): {
  accent: string
  hover: string
  soft: string
  ink: string
  foreground: string
} {
  const parsed = parseHexColor(input)
  const accent = parsed && contrastRatio(parsed.hex, PAPER) >= 4.5 && contrastRatio(parsed.hex, '#ffffff') >= 4.5
    ? parsed.hex
    : CORE_ACCENT
  const rgb = parseHexColor(accent)
  if (!rgb) {
    return {
      accent: CORE_ACCENT,
      hover: CORE_ACCENT_HOVER,
      soft: CORE_ACCENT_SOFT,
      ink: CORE_ACCENT_INK,
      foreground: CORE_ACCENT_FOREGROUND,
    }
  }
  const foreground = contrastRatio(accent, '#ffffff') >= 4.5 ? '#ffffff' : INK
  return {
    accent,
    hover: shiftColor(accent, -22),
    soft: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`,
    ink: contrastRatio(accent, PAPER) >= 4.5 ? accent : CORE_ACCENT_INK,
    foreground,
  }
}

function safeText(input: string | undefined, fallback: string): string {
  const value = input?.trim()
  if (!value) return fallback
  return value.slice(0, 64)
}

function safePattern(input?: string): string {
  const value = input?.trim()
  if (!value || value.length > 420) return 'none'
  if (/url\s*\(/i.test(value)) return 'none'
  if (/[;{}<>]/.test(value)) return 'none'
  if (!/^(radial-gradient|linear-gradient|repeating-linear-gradient|none)/i.test(value)) return 'none'
  return value
}

export function resolvePlatformTheme(
  manifest = ACTIVE_PLATFORM_THEME_MANIFEST,
  now = Date.now(),
): ResolvedPlatformTheme {
  const colors = accentTokens(manifest.accent)
  const accentRgb = parseHexColor(colors.accent) ?? { r: 29, g: 111, b: 66 }
  const bgPattern = safePattern(manifest.bg_pattern?.css)
  return {
    id: manifest.id,
    revision: manifest.revision,
    active: isSeasonalThemeActive(manifest, now),
    label: {
      es: safeText(manifest.label.es, 'DesignerN'),
      en: safeText(manifest.label.en, 'DesignerN'),
    },
    logo: {
      desktop: safeText(manifest.logo?.desktop, DEFAULT_LOGO.desktop),
      compact: safeText(manifest.logo?.compact, DEFAULT_LOGO.compact),
    },
    tagline: {
      es: safeText(manifest.tagline?.es, DEFAULT_TAGLINE.es),
      en: safeText(manifest.tagline?.en, DEFAULT_TAGLINE.en),
    },
    bgPattern,
    spotIllustrations: manifest.spot_illustrations ?? [],
    cssVars: {
      '--color-accent': colors.accent,
      '--color-accent-hover': colors.hover,
      '--color-accent-soft': colors.soft,
      '--color-accent-foreground': colors.foreground,
      '--accent': colors.accent,
      '--accent-hover': colors.hover,
      '--accent-soft': colors.soft,
      '--accent-ink': colors.ink,
      '--fg-inverse': colors.foreground,
      '--glass-tint-accent': `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.16)`,
      '--shadow-glow-accent': `0 0 0 4px rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.16)`,
      '--platform-theme-bg-pattern': bgPattern,
      '--platform-theme-spot-display': manifest.spot_illustrations?.length ? 'block' : 'none',
    },
  }
}

export function getPlatformThemePayload(now = Date.now()) {
  const activeTheme = resolvePlatformTheme(ACTIVE_PLATFORM_THEME_MANIFEST, now)
  return {
    storageKey: PLATFORM_THEME_STORAGE_KEY,
    coreId: PLATFORM_THEME_CORE_ID,
    activeTheme,
    scope: {
      root: true,
      allowedPrefixes: [...PLATFORM_THEME_ALLOWED_PREFIXES],
    },
  }
}

export function buildPlatformThemeBootScript(now = Date.now()): string {
  const payload = getPlatformThemePayload(now)
  return `!function(){var p=${JSON.stringify(payload)};var r=document.documentElement;function ok(a){if(a==="/")return!!p.scope.root;return p.scope.allowedPrefixes.some(function(b){return a===b||a.indexOf(b+"/")===0})}function clear(){r.removeAttribute("data-platform-theme");Object.keys(p.activeTheme.cssVars).forEach(function(k){r.style.removeProperty(k)})}function apply(){r.setAttribute("data-platform-theme",p.activeTheme.id);Object.keys(p.activeTheme.cssVars).forEach(function(k){r.style.setProperty(k,p.activeTheme.cssVars[k])})}try{if(!p.activeTheme.active||!ok(location.pathname)){clear();return}var pref=localStorage.getItem(p.storageKey);if(pref===p.activeTheme.id){apply()}else{clear();if(pref&&pref!==p.coreId)localStorage.setItem(p.storageKey,p.coreId)}}catch(e){clear()}}();`
}
