import Script from 'next/script'
import { buildPlatformThemeBootScript } from '@/lib/platform-theme'

export default function PlatformThemeScript() {
  return (
    <Script
      id="platform-theme-bootstrap"
      strategy="beforeInteractive"
      dangerouslySetInnerHTML={{ __html: buildPlatformThemeBootScript() }}
    />
  )
}
