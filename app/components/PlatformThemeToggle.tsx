'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  getPlatformThemePayload,
  isPlatformThemeEligiblePath,
  PLATFORM_THEME_CORE_ID,
  type PlatformThemeChoice,
} from '@/lib/platform-theme'

type Labels = {
  label: string
  core: string
  seasonal: string
  coreTitle: string
  seasonalTitle: string
  activeCore: string
  activeSeasonal: string
}

type Props = {
  labels: Labels
  variant: 'desktop' | 'mobile'
  initialEligible: boolean
}

const payload = getPlatformThemePayload()
const seasonal = payload.activeTheme

function clearTheme() {
  const root = document.documentElement
  root.removeAttribute('data-platform-theme')
  Object.keys(seasonal.cssVars).forEach(name => root.style.removeProperty(name))
}

function applySeasonalTheme() {
  const root = document.documentElement
  root.setAttribute('data-platform-theme', seasonal.id)
  Object.entries(seasonal.cssVars).forEach(([name, value]) => root.style.setProperty(name, value))
}

function readPreference(): PlatformThemeChoice {
  try {
    return window.localStorage.getItem(payload.storageKey) === seasonal.id ? seasonal.id : PLATFORM_THEME_CORE_ID
  } catch {
    return PLATFORM_THEME_CORE_ID
  }
}

function writePreference(choice: PlatformThemeChoice) {
  try {
    window.localStorage.setItem(payload.storageKey, choice)
  } catch {
    // Storage can be unavailable in private/locked-down contexts; the toggle
    // still works for the current page by applying the attribute directly.
  }
}

function deferChoiceUpdate(setChoice: (choice: PlatformThemeChoice) => void, choice: PlatformThemeChoice) {
  queueMicrotask(() => setChoice(choice))
}

export default function PlatformThemeToggle({ labels, variant, initialEligible }: Props) {
  const pathname = usePathname()
  const eligible = seasonal.active && isPlatformThemeEligiblePath(pathname)
  const [choice, setChoice] = useState<PlatformThemeChoice>(PLATFORM_THEME_CORE_ID)

  useEffect(() => {
    if (!eligible) {
      clearTheme()
      deferChoiceUpdate(setChoice, readPreference())
      return
    }

    const saved = readPreference()
    deferChoiceUpdate(setChoice, saved)
    if (saved === seasonal.id) applySeasonalTheme()
    else clearTheme()
  }, [eligible, pathname])

  const activeSeasonal = choice === seasonal.id && eligible
  const title = activeSeasonal ? labels.coreTitle : labels.seasonalTitle
  const status = activeSeasonal ? labels.activeSeasonal : labels.activeCore
  // The seasonal/designer theme feature owns the `flask` glyph; the AI agent
  // feature keeps `sparks` (the industry-standard AI icon) so the two are
  // visually distinct in the navbar chrome.
  const icon = 'iconoir-flask'

  const className = useMemo(() => {
    return [
      'platform-theme-toggle',
      `platform-theme-toggle-${variant}`,
      activeSeasonal ? 'is-seasonal' : 'is-core',
    ].join(' ')
  }, [activeSeasonal, variant])

  if (!seasonal.active || (!initialEligible && !eligible)) return null

  function toggle() {
    const next = activeSeasonal ? PLATFORM_THEME_CORE_ID : seasonal.id
    writePreference(next)
    setChoice(next)
    if (eligible && next === seasonal.id) applySeasonalTheme()
    else clearTheme()
  }

  return (
    <button
      type="button"
      className={className}
      data-platform-theme-toggle
      aria-label={labels.label}
      aria-pressed={activeSeasonal}
      title={title}
      onClick={toggle}
    >
      <span className="platform-theme-toggle-icon" aria-hidden>
        <i className={icon} />
      </span>
      <span className="platform-theme-toggle-copy">
        <span>{activeSeasonal ? labels.seasonal : labels.core}</span>
        <small>{status}</small>
      </span>
    </button>
  )
}
