import Link from 'next/link'
import { resolvePlatformTheme } from '@/lib/platform-theme'

type Props = {
  variant: 'desktop' | 'mobile'
}

export default function PlatformBrand({ variant }: Props) {
  const seasonal = resolvePlatformTheme()
  const className = variant === 'desktop' ? 'platform-brand platform-brand-desktop' : 'platform-brand platform-brand-mobile'

  return (
    <Link href="/" className={className} aria-label="Miyagi Sanchez - inicio">
      <span className="platform-brand-core" aria-hidden>
        {variant === 'mobile' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/favicon.svg" alt="" width={30} height={30} />
        ) : (
          <>
            <span className="platform-brand-word">Miyagi</span>
            <span className="platform-brand-dot">●</span>
            <span className="platform-brand-word">Sanchez</span>
          </>
        )}
      </span>
      <span className="platform-brand-seasonal" aria-hidden>
        {variant === 'mobile' ? (
          <span className="platform-brand-seasonal-compact">{seasonal.logo.compact}</span>
        ) : (
          <>
            <span className="platform-brand-seasonal-line">{seasonal.logo.desktop}</span>
            <span className="platform-brand-seasonal-tagline">{seasonal.tagline.es}</span>
          </>
        )}
      </span>
    </Link>
  )
}
